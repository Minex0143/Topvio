import base64
import io
import json
import math
import os
import re
import html
import zipfile
from functools import wraps
from urllib.parse import quote

from authlib.integrations.flask_client import OAuth
from cryptography.fernet import Fernet
from flask import Flask, abort, flash, jsonify, redirect, render_template, request, send_file, session, url_for
from flask_login import LoginManager, current_user, login_required, login_user, logout_user
from PIL import Image, ImageOps
from dotenv import load_dotenv

from models import db, User, Property, ImageAsset

load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'change-this-secret-in-production')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///topvio.db').replace('postgres://', 'postgresql://', 1)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 15 * 1024 * 1024
app.config['GOOGLE_CLIENT_ID'] = os.getenv('GOOGLE_CLIENT_ID', '')
app.config['GOOGLE_CLIENT_SECRET'] = os.getenv('GOOGLE_CLIENT_SECRET', '')
app.config['GOOGLE_REDIRECT_URI'] = os.getenv('GOOGLE_REDIRECT_URI', '')
app.config['ADMIN_EMAILS'] = {x.strip().lower() for x in os.getenv('ADMIN_EMAILS', '').split(',') if x.strip()}

fernet_key = os.getenv('AADHAR_ENCRYPTION_KEY', '')
if fernet_key:
    fernet = Fernet(fernet_key.encode())
else:
    fernet = None

db.init_app(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
oauth = OAuth(app)

google = oauth.register(
    name='google',
    client_id=app.config['GOOGLE_CLIENT_ID'],
    client_secret=app.config['GOOGLE_CLIENT_SECRET'],
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)

@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))

with app.app_context():
    db.create_all()

def admin_required(fn):
    @wraps(fn)
    @login_required
    def wrapper(*args, **kwargs):
        if current_user.role != 'admin':
            abort(403)
        return fn(*args, **kwargs)
    return wrapper

def encrypt_aadhar(value):
    if not value:
        return None
    if not fernet:
        return value
    return fernet.encrypt(value.encode()).decode()

def decrypt_aadhar(value):
    if not value:
        return ''
    if not fernet:
        return value
    try:
        return fernet.decrypt(value.encode()).decode()
    except Exception:
        return ''

def normalize_number(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*r*math.asin(math.sqrt(a))

def process_image(file_storage):
    raw = file_storage.read()
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    if image.mode not in ('RGB', 'RGBA'):
        image = image.convert('RGB')
    out = io.BytesIO()
    image.save(out, format='WEBP', quality=82, method=6)
    return out.getvalue()

def parse_json_form(name):
    try:
        return json.loads(request.form.get(name, '{}'))
    except json.JSONDecodeError:
        abort(400, description=f'Invalid JSON in {name}')

def unit_is_available(unit):
    """Inventory flag is backward-compatible: old units are available by default."""
    return bool(unit.get('available', True))


def _inventory_unit(structure, property_type, unit_key, available):
    """Update one unit's inventory state inside the JSONB structure."""
    if not unit_key:
        return False

    def update_units(units):
        for unit in units or []:
            if unit.get('label') == unit_key:
                unit['available'] = bool(available)
                return True
        return False

    if property_type == 'individual':
        return update_units(structure.get('units', []))

    if property_type == 'apartment':
        for floor in structure.get('floors', []):
            if update_units(floor.get('units', [])):
                return True
        return False

    if property_type == 'gated':
        for apartment in structure.get('apartments', []):
            for floor in apartment.get('floors', []):
                if update_units(floor.get('units', [])):
                    return True
        return False

    return False


def _inventory_summary(structure, property_type):
    """Return total/available counts for the admin inventory screen."""
    units = []
    if property_type == 'individual':
        units = structure.get('units', [])
    elif property_type == 'apartment':
        units = [u for f in structure.get('floors', []) for u in f.get('units', [])]
    elif property_type == 'gated':
        units = [
            u
            for a in structure.get('apartments', [])
            for f in a.get('floors', [])
            for u in f.get('units', [])
        ]
    available = sum(1 for u in units if unit_is_available(u))
    return {'total': len(units), 'available': available, 'unavailable': len(units) - available}


@app.context_processor
def inject_globals():
    return {'app_name': 'Topvio'}

@app.route('/')
def index():
    q = request.args.get('q', '').strip()
    user_lat = request.args.get('lat', type=float)
    user_lng = request.args.get('lng', type=float)
    query = Property.query.filter_by(is_listed=True)
    properties = query.order_by(Property.created_at.desc()).all()
    if q:
        ql = q.lower()
        filtered = []
        for p in properties:
            hay = f'{p.name} {p.address}'.lower()
            address_match = ql in hay
            nearby = False
            if user_lat is not None and user_lng is not None and p.latitude is not None and p.longitude is not None:
                nearby = haversine_km(user_lat, user_lng, p.latitude, p.longitude) <= 50
            if address_match or nearby:
                filtered.append(p)
        properties = filtered
    return render_template('index.html', properties=properties, q=q, user_lat=user_lat, user_lng=user_lng)

@app.route('/login')
def login():
    next_url = request.args.get('next') or url_for('index')
    session['next_after_login'] = next_url
    if not app.config['GOOGLE_CLIENT_ID'] or not app.config['GOOGLE_CLIENT_SECRET']:
        return render_template('login.html', config_missing=True)
    redirect_uri = app.config['GOOGLE_REDIRECT_URI'] or url_for('auth_callback', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/auth/google/callback')
def auth_callback():
    token = google.authorize_access_token()
    userinfo = token.get('userinfo')
    if not userinfo:
        userinfo = google.get('https://openidconnect.googleapis.com/v1/userinfo').json()
    email = (userinfo.get('email') or '').lower()
    if not email:
        abort(400, description='Google did not provide an email address.')
    user = User.query.filter_by(email=email).first()
    role = 'admin' if email in app.config['ADMIN_EMAILS'] else 'user'
    if not user:
        user = User(google_id=userinfo.get('sub'), email=email, name=userinfo.get('name') or email, picture=userinfo.get('picture'), role=role)
        db.session.add(user)
    else:
        user.google_id = userinfo.get('sub') or user.google_id
        user.name = userinfo.get('name') or user.name
        user.picture = userinfo.get('picture') or user.picture
        if email in app.config['ADMIN_EMAILS']:
            user.role = 'admin'
    db.session.commit()
    login_user(user)
    next_url = session.pop('next_after_login', None) or url_for('index')
    return redirect(next_url)

@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('index'))

@app.route('/admin')
@admin_required
def admin_dashboard():
    properties = Property.query.order_by(Property.created_at.desc()).all()
    return render_template('admin_dashboard.html', properties=properties)


def _validate_property_payload(payload, files_required=True):
    required = ['owner', 'property', 'property_type', 'structure', 'construction']
    if not all(payload.get(k) for k in required):
        return 'Complete all required steps before saving the property.'

    owner = payload['owner']
    prop = payload['property']
    ptype = payload['property_type']
    construction = payload['construction']
    structure = payload['structure']

    if not re.fullmatch(r'\d{10}', re.sub(r'\D', '', owner.get('contact', ''))):
        return 'Owner contact must be a 10-digit number.'
    if not owner.get('aadhar') or not re.fullmatch(r'\d{12}', re.sub(r'\D', '', owner.get('aadhar', ''))):
        return 'Aadhar number must contain 12 digits.'
    if ptype not in {'individual', 'apartment', 'gated'}:
        return 'Invalid property type.'
    if not prop.get('name') or not prop.get('address'):
        return 'Property name and address are required.'
    if not prop.get('map_location'):
        return 'Map location URL is required.'
    if not construction.get('start') or not construction.get('end'):
        return 'Construction start and end month/year are required.'

    if ptype == 'individual' and not structure.get('units'):
        return 'Add all required units.'
    if ptype == 'apartment' and not structure.get('floors'):
        return 'Add all required floors and units.'
    if ptype == 'gated' and not structure.get('apartments'):
        return 'Add all gated-community apartments, floors and units.'

    if files_required:
        has_new_overview = any(k.startswith('overview_') for k in request.files)
        if not has_new_overview:
            return 'Upload at least one property overview image.'

    return None


def _save_uploaded_images(property_obj):
    """Store newly uploaded images as optimized WebP assets."""
    for key, file in request.files.items():
        if not file or not file.filename:
            continue
        try:
            data = process_image(file)
        except Exception:
            continue

        filename = os.path.splitext(file.filename)[0] + '.webp'
        if key.startswith('overview_'):
            db.session.add(ImageAsset(
                property_id=property_obj.id,
                scope='overview',
                filename=filename,
                data=data
            ))
        elif key.startswith('unit_'):
            parts = key.split('_')
            unit_key = '_'.join(parts[1:-1]) if len(parts) > 2 else parts[1]
            db.session.add(ImageAsset(
                property_id=property_obj.id,
                scope='unit',
                unit_key=unit_key,
                filename=filename,
                data=data
            ))


def _apply_deleted_images(property_obj):
    raw = request.form.get('deleted_image_ids', '[]')
    try:
        deleted_ids = {int(x) for x in json.loads(raw)}
    except (TypeError, ValueError, json.JSONDecodeError):
        deleted_ids = set()

    if not deleted_ids:
        return

    for image in list(property_obj.images):
        if image.id in deleted_ids:
            db.session.delete(image)


def _property_initial_data(property_obj):
    return {
        'id': property_obj.id,
        'owner': {
            'name': property_obj.owner_name,
            'contact': property_obj.owner_contact,
            'email': property_obj.owner_email,
            'aadhar': decrypt_aadhar(property_obj.owner_aadhar_encrypted),
        },
        'property': {
            'name': property_obj.name,
            'address': property_obj.address,
            'map_location': property_obj.map_location or '',
            'latitude': property_obj.latitude,
            'longitude': property_obj.longitude,
        },
        'property_type': property_obj.property_type,
        'structure': property_obj.structure_data or {},
        'documents': property_obj.property_documents or '',
        'construction': {
            'completed': bool(property_obj.construction_completed),
            'start': property_obj.construction_start or '',
            'end': property_obj.construction_end or '',
        },
        'important_details': property_obj.important_details or '',
        'is_listed': bool(property_obj.is_listed),
        'images': [
            {
                'id': image.id,
                'scope': image.scope,
                'unit_key': image.unit_key,
                'filename': image.filename,
                'url': url_for('image', image_id=image.id),
            }
            for image in property_obj.images
        ],
    }


@app.route('/admin/property/new', methods=['GET', 'POST'])
@app.route('/admin/property/<int:property_id>/edit', methods=['GET', 'POST'])
@admin_required
def property_wizard(property_id=None):
    property_obj = db.session.get(Property, property_id) if property_id else None
    if property_id and not property_obj:
        abort(404)

    if request.method == 'GET':
        initial_data = _property_initial_data(property_obj) if property_obj else {
            'id': None,
            'owner': {'name': '', 'contact': '', 'email': '', 'aadhar': ''},
            'property': {'name': '', 'address': '', 'map_location': '', 'latitude': '', 'longitude': ''},
            'property_type': '',
            'structure': {},
            'documents': '',
            'construction': {'completed': False, 'start': '', 'end': ''},
            'important_details': '',
            'is_listed': False,
            'images': [],
        }
        return render_template(
            'property_wizard.html',
            editing=bool(property_obj),
            property=property_obj,
            initial_data=initial_data
        )

    payload = parse_json_form('payload')
    validation_error = _validate_property_payload(payload, files_required=not bool(property_obj))
    if validation_error:
        return jsonify(ok=False, error=validation_error), 400

    owner = payload['owner']
    prop = payload['property']
    ptype = payload['property_type']
    construction = payload['construction']
    structure = payload['structure']

    if property_obj is None:
        property_obj = Property(created_by_id=current_user.id)
        db.session.add(property_obj)
    else:
        # If the admin changes property type, all submitted structure data becomes
        # the new source of truth; images not explicitly deleted remain intact.
        pass

    property_obj.name = prop['name'].strip()
    property_obj.address = prop['address'].strip()
    property_obj.map_location = prop.get('map_location')
    property_obj.latitude = normalize_number(prop.get('latitude'), None) if prop.get('latitude') not in ('', None) else None
    property_obj.longitude = normalize_number(prop.get('longitude'), None) if prop.get('longitude') not in ('', None) else None
    property_obj.owner_name = owner['name'].strip()
    property_obj.owner_contact = re.sub(r'\D', '', owner['contact'])
    property_obj.owner_email = owner['email'].strip()
    property_obj.owner_aadhar_encrypted = encrypt_aadhar(re.sub(r'\D', '', owner['aadhar']))
    property_obj.property_type = ptype
    property_obj.structure_data = structure
    property_obj.property_documents = payload.get('documents', '')
    property_obj.construction_completed = bool(construction.get('completed'))
    property_obj.construction_start = construction.get('start')
    property_obj.construction_end = construction.get('end')
    property_obj.important_details = payload.get('important_details', '')

    # New properties are published by default; edited properties keep their
    # current enabled/disabled state unless the admin explicitly asks to change it.
    if property_id is None:
        property_obj.is_listed = bool(payload.get('publish'))

    db.session.flush()
    _apply_deleted_images(property_obj)
    db.session.flush()

    # Never leave a property with zero overview images.
    new_overview_count = sum(
        1 for key, file in request.files.items()
        if key.startswith('overview_') and file and file.filename
    )
    remaining_overview_count = ImageAsset.query.filter_by(
        property_id=property_obj.id, scope='overview'
    ).count()
    if remaining_overview_count + new_overview_count == 0:
        db.session.rollback()
        return jsonify(ok=False, error='Keep at least one property overview image.'), 400

    _save_uploaded_images(property_obj)
    db.session.commit()

    return jsonify(
        ok=True,
        redirect=url_for('admin_dashboard'),
        message='Property updated successfully.' if property_id else 'Property listed successfully.'
    )


@app.get('/admin/property/<int:property_id>/inventory')
@admin_required
def property_inventory(property_id):
    property_obj = db.session.get(Property, property_id)
    if not property_obj:
        abort(404)
    structure = property_obj.structure_data or {}
    summary = _inventory_summary(structure, property_obj.property_type)
    return render_template(
        'property_inventory.html',
        property=property_obj,
        structure=structure,
        summary=summary,
        unit_is_available=unit_is_available,
    )


@app.post('/admin/property/<int:property_id>/inventory/update')
@admin_required
def update_inventory(property_id):
    property_obj = db.session.get(Property, property_id)
    if not property_obj:
        abort(404)

    payload = request.get_json(silent=True) or {}
    unit_key = str(payload.get('unit_key', '')).strip()
    available = bool(payload.get('available', False))

    structure = json.loads(json.dumps(property_obj.structure_data or {}))
    if not _inventory_unit(structure, property_obj.property_type, unit_key, available):
        return jsonify(ok=False, error='Unit was not found in this property inventory.'), 404

    property_obj.structure_data = structure
    db.session.commit()

    summary = _inventory_summary(structure, property_obj.property_type)
    return jsonify(ok=True, unit_key=unit_key, available=available, summary=summary)


@app.post('/admin/property/<int:property_id>/toggle')
@admin_required
def toggle_property(property_id):
    property_obj = db.session.get(Property, property_id)
    if not property_obj:
        abort(404)
    property_obj.is_listed = not property_obj.is_listed
    db.session.commit()
    return jsonify(ok=True, is_listed=property_obj.is_listed)


@app.post('/admin/property/<int:property_id>/delete')
@admin_required
def delete_property(property_id):
    property_obj = db.session.get(Property, property_id)
    if not property_obj:
        abort(404)
    db.session.delete(property_obj)
    db.session.commit()
    return jsonify(ok=True, redirect=url_for('admin_dashboard'))


@app.get('/admin/property/<int:property_id>/download')
@admin_required
def download_property(property_id):
    property_obj = db.session.get(Property, property_id)
    if not property_obj:
        abort(404)

    overview = [i for i in property_obj.images if i.scope == 'overview']
    unit_images = [i for i in property_obj.images if i.scope == 'unit']

    export_data = {
        'export_version': '1.0',
        'property': {
            'id': property_obj.id,
            'name': property_obj.name,
            'address': property_obj.address,
            'map_location': property_obj.map_location,
            'latitude': property_obj.latitude,
            'longitude': property_obj.longitude,
            'property_type': property_obj.property_type,
            'is_enabled': property_obj.is_listed,
            'created_at': property_obj.created_at.isoformat() if property_obj.created_at else None,
            'updated_at': property_obj.updated_at.isoformat() if property_obj.updated_at else None,
        },
        'owner': {
            'name': property_obj.owner_name,
            'contact': property_obj.owner_contact,
            'email': property_obj.owner_email,
            'aadhar': decrypt_aadhar(property_obj.owner_aadhar_encrypted),
        },
        'documents': property_obj.property_documents or '',
        'construction': {
            'completed': property_obj.construction_completed,
            'start': property_obj.construction_start,
            'end': property_obj.construction_end,
        },
        'important_details': property_obj.important_details or '',
        'structure': property_obj.structure_data or {},
        'images': {
            'overview': [i.filename for i in overview],
            'unit_images': [
                {'unit_key': i.unit_key, 'filename': i.filename}
                for i in unit_images
            ],
        },
    }

    safe_name = re.sub(r'[^A-Za-z0-9_-]+', '_', property_obj.name).strip('_') or f'property_{property_obj.id}'
    memory = io.BytesIO()
    with zipfile.ZipFile(memory, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            'property_data.json',
            json.dumps(export_data, indent=2, ensure_ascii=False)
        )

        report_html = render_template(
            'property_export.html',
            property=property_obj,
            structure=property_obj.structure_data or {},
            overview=overview,
            unit_images=unit_images,
            aadhar=decrypt_aadhar(property_obj.owner_aadhar_encrypted),
        )
        archive.writestr('property_report.html', report_html)

        for index, image in enumerate(overview, 1):
            archive.writestr(
                f'images/overview/{index:02d}_{image.filename}',
                image.data
            )

        unit_counters = {}
        for image in unit_images:
            unit_folder = re.sub(r'[^A-Za-z0-9_-]+', '_', image.unit_key or 'unit')
            unit_counters[unit_folder] = unit_counters.get(unit_folder, 0) + 1
            index = unit_counters[unit_folder]
            archive.writestr(
                f'images/units/{unit_folder}/{index:02d}_{image.filename}',
                image.data
            )

    memory.seek(0)
    return send_file(
        memory,
        mimetype='application/zip',
        as_attachment=True,
        download_name=f'{safe_name}_Topvio_export.zip'
    )

@app.route('/property/<int:property_id>')
def property_detail(property_id):
    property_obj = db.session.get(Property, property_id)
    if not property_obj or not property_obj.is_listed:
        abort(404)
    if not current_user.is_authenticated:
        return redirect(url_for('login', next=url_for('property_detail', property_id=property_id)))
    overview = [i for i in property_obj.images if i.scope == 'overview']
    units = [i for i in property_obj.images if i.scope == 'unit']
    return render_template('property_detail.html', property=property_obj, overview=overview, unit_images=units, aadhar=decrypt_aadhar(property_obj.owner_aadhar_encrypted))

@app.route('/image/<int:image_id>')
def image(image_id):
    asset = db.session.get(ImageAsset, image_id)
    if not asset:
        abort(404)
    return send_file(io.BytesIO(asset.data), mimetype=asset.mime_type, download_name=asset.filename, max_age=86400)

@app.errorhandler(403)
def forbidden(_):
    return render_template('error.html', code=403, message='You do not have permission to access this page.'), 403

@app.errorhandler(404)
def not_found(_):
    return render_template('error.html', code=404, message='Page or property not found.'), 404

@app.errorhandler(413)
def too_large(_):
    return render_template('error.html', code=413, message='Image upload is too large. Please use smaller images.'), 413

@app.errorhandler(500)
def server_error(_):
    db.session.rollback()
    return render_template('error.html', code=500, message='Something went wrong. Check the Render logs for details.'), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5000)), debug=True)

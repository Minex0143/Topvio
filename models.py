from flask_sqlalchemy import SQLAlchemy
from flask_login import UserMixin
from datetime import datetime
from sqlalchemy.dialects.postgresql import JSONB

db = SQLAlchemy()

class User(UserMixin, db.Model):
    __tablename__ = 'users'
    id = db.Column(db.Integer, primary_key=True)
    google_id = db.Column(db.String(255), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    name = db.Column(db.String(255), nullable=False)
    picture = db.Column(db.Text)
    role = db.Column(db.String(20), nullable=False, default='user')
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

class Property(db.Model):
    __tablename__ = 'properties'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    address = db.Column(db.Text, nullable=False)
    map_location = db.Column(db.Text)
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    owner_name = db.Column(db.String(255), nullable=False)
    owner_contact = db.Column(db.String(30), nullable=False)
    owner_email = db.Column(db.String(255), nullable=False)
    owner_aadhar_encrypted = db.Column(db.Text)
    property_type = db.Column(db.String(40), nullable=False)
    structure_data = db.Column(JSONB, nullable=False, default=dict)
    property_documents = db.Column(db.Text)
    construction_completed = db.Column(db.Boolean, nullable=False, default=False)
    construction_start = db.Column(db.String(7))
    construction_end = db.Column(db.String(7))
    important_details = db.Column(db.Text)
    is_listed = db.Column(db.Boolean, nullable=False, default=False)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    images = db.relationship('ImageAsset', backref='property', cascade='all, delete-orphan', lazy=True)
    created_by = db.relationship('User')

class ImageAsset(db.Model):
    __tablename__ = 'image_assets'
    id = db.Column(db.Integer, primary_key=True)
    property_id = db.Column(db.Integer, db.ForeignKey('properties.id'), nullable=False, index=True)
    scope = db.Column(db.String(20), nullable=False)  # overview / unit
    unit_key = db.Column(db.String(100))
    filename = db.Column(db.String(255), nullable=False)
    mime_type = db.Column(db.String(100), nullable=False, default='image/webp')
    data = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)

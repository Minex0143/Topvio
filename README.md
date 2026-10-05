# Topvio

A Render-ready Flask + PostgreSQL property discovery MVP.

## Included

- Google/Gmail sign-in using Google OAuth 2.0.
- Role assignment using `ADMIN_EMAILS`.
- Admin property-listing wizard with 8 steps.
- Individual house: 1–100 units.
- Apartments: 1–40 floors.
- Gated community: 1–25 apartments and 1–40 floors.
- Unit type 1 BHK–6 BHK, facing, size in sq yd/sq m, dimensions and pricing range.
- Apartment workflow supports a different number of units on every floor.
- Gated community workflow supports a different number of floors and units for every apartment/floor.
- Sq yd → sq m automatic conversion in the admin wizard.
- Responsive dual-handle price range slider (₹ lakh / ₹ crore display).
- Per-image add, replace and delete controls for unit and property overview galleries before publishing or while editing.
- Admin can modify all 8 property steps after creation without rebuilding the property.
- Admin can enable/disable each property; disabled properties are hidden from user search and direct property pages.
- Admin can permanently delete a property and its uploaded images.
- Admin can download a complete ZIP export containing a readable HTML report, structured JSON, and all WebP images.
- Multiple unit images and property overview images.
- Server-side conversion of uploaded images to WebP.
- PostgreSQL persistence.
- Optional map URL + latitude/longitude for nearby searches.
- Location search by address and optional browser location (within 50 km when coordinates are available).
- User must sign in with Google before opening full property details.
- WhatsApp enquiry links containing the selected property/unit/floor information.
- Aadhar is encrypted with a Fernet key before database storage.
- Render Blueprint (`render.yaml`) for the web service and PostgreSQL database.

## Important MVP note

For temporary deployment, image bytes are stored in PostgreSQL. This keeps the deployment simple and avoids another service. For production, move images to object storage/CDN (for example Cloudflare R2, S3-compatible storage, or another image/object service) and keep only image URLs/keys in PostgreSQL.

## Local setup

1. Install Python 3.11+.
2. Create a virtual environment.
3. Run `pip install -r requirements.txt`.
4. Copy `.env.example` to `.env` and fill the values.
5. Create a PostgreSQL database called `topvio`, or use the supplied SQLite fallback for a quick local UI test.
6. Generate the encryption key:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

7. Start the app:

```bash
python app.py
```

Open `http://localhost:5000`.

## Google sign-in setup

Create a Google OAuth Web application in Google Cloud Console.

Local authorized redirect URI:

`http://localhost:5000/auth/google/callback`

After Render gives you a URL, add:

`https://YOUR-RENDER-SERVICE.onrender.com/auth/google/callback`

Set the same Render URL in `GOOGLE_REDIRECT_URI`.

Do not commit the Google client secret or `.env` file.

## Render setup

### Option A — Blueprint

1. Push this repository to GitHub.
2. In Render, create a new Blueprint and select the repository.
3. Render reads `render.yaml` and creates the `topvio` web service plus the `topvio-db` PostgreSQL database.
4. Fill the prompted secret environment variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
   - `ADMIN_EMAILS`
   - `AADHAR_ENCRYPTION_KEY`
5. Deploy.
6. Copy the generated `onrender.com` URL.
7. Add its `/auth/google/callback` URL to the Google OAuth client's authorized redirect URIs.
8. Save/redeploy on Render.

### Option B — Dashboard manually

Create a Render PostgreSQL database first, then a Python Web Service connected to the GitHub repository.

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
gunicorn app:app
```

Add these environment variables:

```text
DATABASE_URL=<Render internal PostgreSQL connection string>
SECRET_KEY=<strong random value>
GOOGLE_CLIENT_ID=<Google OAuth client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth client secret>
GOOGLE_REDIRECT_URI=https://YOUR-APP.onrender.com/auth/google/callback
ADMIN_EMAILS=youradmin@gmail.com
AADHAR_ENCRYPTION_KEY=<Fernet key>
```

Use the database's internal connection string when the web service and database are in the same Render region/account.

## Making an account an admin

Put the Google account email in `ADMIN_EMAILS`, for example:

```text
ADMIN_EMAILS=admin@gmail.com,another-admin@gmail.com
```

When that Google account signs in, the application assigns the `admin` role automatically.

## First use

1. Sign in with the Google account configured in `ADMIN_EMAILS`.
2. Open **Admin**.
3. Click **List property**.
4. Complete all 8 steps.
5. Upload at least one overview image.
6. Add map URL and, for reliable nearby matching, latitude/longitude.
7. On Step 8 click **List property**.
8. Open the public home page and search by the property location.
9. A normal user can open the property only after Google sign-in.
10. Select a unit/floor/apartment option and use **Connect with team** to open WhatsApp with the selection pre-filled.

## Deployment caveats

- Google OAuth requires the callback URI to exactly match the configured URI.
- Do not store Google credentials in GitHub.
- The temporary PostgreSQL image-storage approach is convenient for an MVP but should be replaced with object storage + CDN before large-scale use.
- Aadhar is sensitive personal data. Keep access restricted to admins, use a strong encryption key, and add appropriate retention/deletion controls before production use.

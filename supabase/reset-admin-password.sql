-- Run this in Supabase SQL Editor if the deployed admin login rejects the saved password.
-- It repairs the seeded admin account without exposing the password in the public UI.

UPDATE admins
SET password_hash = 'a303ea67e5fce9601cace5fbc1ea0ae6d37d232302341862b077eea1a680a03b',
    role = 'superadmin'
WHERE username = 'admin';

INSERT INTO admins (username, password_hash, role)
SELECT 'admin', 'a303ea67e5fce9601cace5fbc1ea0ae6d37d232302341862b077eea1a680a03b', 'superadmin'
WHERE NOT EXISTS (SELECT 1 FROM admins WHERE username = 'admin');

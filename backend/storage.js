const path = require('path');

const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'flags';
const hasSupabaseStorage = Boolean(
  process.env.SUPABASE_URL &&
  (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
);

function getPublicUrl(filePath) {
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );
  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

async function uploadFlag(file) {
  if (!hasSupabaseStorage) {
    return `/uploads/${file.filename}`;
  }

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  );

  const ext = path.extname(file.originalname) || '.png';
  const filePath = `flags/flag_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });

  if (error) throw error;
  return getPublicUrl(filePath);
}

module.exports = {
  hasSupabaseStorage,
  uploadFlag
};

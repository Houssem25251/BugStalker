import 'dotenv/config';

// Single place that reads + validates env. Fail fast and loud if something's missing.
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  // bcrypt work factor. 12 is a sane 2025 default for an interactive login.
  bcryptRounds: 12,
};
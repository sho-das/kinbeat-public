import { resolve } from 'node:path';
import { config } from 'dotenv';

// All settings live in one file, .env at the repository root, shared by the API, its scripts and the website.
// This file runs from api/src (or api/dist once built), so the root is two folders up.
config({ path: resolve(__dirname, '../../.env') });

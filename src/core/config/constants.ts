import { join } from 'path';
import { homedir } from 'os';

export const BASE44_DIR = join(homedir(), '.base44');
export const AUTH_DIR = join(BASE44_DIR, 'auth');
export const AUTH_FILE_PATH = join(AUTH_DIR, 'auth.json');


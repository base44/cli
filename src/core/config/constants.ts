import { join } from 'path';
import { homedir } from 'os';

export const BASE44_DIR = join(homedir(), '.base44');
export const AUTH_DIR = join(BASE44_DIR, 'auth');
export const AUTH_FILE_PATH = join(AUTH_DIR, 'auth.json');

export const PROJECT_CONFIG_FILE = 'base44.config.json';
export const FUNCTION_CONFIG_FILE = 'function.json';


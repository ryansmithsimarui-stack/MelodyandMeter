// Programmatic Jest runner to avoid PATH issues with ampersand in directory name.
process.env.NODE_ENV = 'test';
require('jest').run();

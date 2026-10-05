import { defineConfig } from 'cypress';

export default defineConfig({
  projectId: 'onnqy3',
  e2e: {
    baseUrl: 'http://localhost:5055',
    video: true,
  },
  env: {
    ADMIN_EMAIL: 'admin@shufflerr.test',
    ADMIN_PASSWORD: 'test1234',
    USER_EMAIL: 'demo@shufflerr.test',
    USER_PASSWORD: 'test1234',
  },
  retries: {
    runMode: 2,
    openMode: 0,
  },
});

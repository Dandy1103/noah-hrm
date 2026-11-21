const target = 'http://127.0.0.1:' + (process.env.HRM_BACKEND_PORT || '3001');
export default Object.fromEntries(['/auth', '/api'].map((path) => [path, { target }]));

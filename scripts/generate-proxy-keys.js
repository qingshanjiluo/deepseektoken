#!/usr/bin/env node
const path = require('path');
const { ProxyKeyStore } = require(path.join(__dirname, '..', 'src', 'auth', 'proxyKeyStore'));

const store = new ProxyKeyStore({ filePath: path.join(__dirname, '..', 'proxy-auth.json') });
store.load();
store.setEnabled(true);

const apiKey = store.generateApiKey();
store.addApiKey(apiKey);

const bearerToken = store.generateBearerToken();
store.addBearerToken(bearerToken);

store.save();

console.log('');
console.log('Proxy auth enabled!');
console.log('  API Key      : ' + apiKey);
console.log('  Bearer Token : ' + bearerToken);
console.log('');
console.log('Use them in your client:');
console.log('  curl -H "x-api-key: ' + apiKey + '" http://localhost:9655/v1/chat/completions ...');
console.log('  curl -H "Authorization: Bearer ' + bearerToken + '" http://localhost:9655/v1/chat/completions ...');
console.log('');

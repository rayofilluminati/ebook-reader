// Local test double only. No real model, API key, or external network is used.
import { createServer } from 'node:http';

createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404);
    response.end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const source = body.messages.at(-1).content;
  const content =
    source === '今日はいい天気ですね。'
      ? '今天天气真好啊。'
      : '清晨的风穿过窗边，带来了远方海潮的气息。她轻轻合上书，望向阳光下的小路。今天又会发生怎样的故事呢？';
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }]
    })
  );
}).listen(11435, '127.0.0.1', () => console.log('Mock translation API: http://127.0.0.1:11435/v1'));

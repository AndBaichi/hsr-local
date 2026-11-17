// asset 协议探针的接收端（临时脚本，验证后删除）
// 用法：node scripts/probe-server.mjs  → 把每个请求的完整 URL 打到 stdout
import { createServer } from 'node:http';

const PORT = 4199;

createServer((req, res) => {
  // 探针把结果放在 query 里；这里只负责打印，不做任何解析
  console.log(`[hit] ${decodeURIComponent(req.url ?? '')}`);
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
  res.end();
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[probe-server] listening on http://127.0.0.1:${PORT}`);
});

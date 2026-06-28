const path = require('path');

const DEFAULT_INJECTION_PROMPT = [
  '你现在处于严格工具调用模式。',
  '如果需要调用工具，每次只能调用一个工具。',
  '调用工具时只输出严格格式化的工具请求，不要输出解释、寒暄、分析过程或废话。',
  '工具参数必须最小化且合法，不要编造结果。',
  '收到工具结果后，再给出最终 API 调用信息或结论。',
  '如果不需要工具，就直接给出简洁答案。',
].join('\n');

function getProxyDefaults(env = process.env) {
  return {
    defaultInjectionPrompt:
      env.DEEPSEEK_DEFAULT_INJECTION_PROMPT || DEFAULT_INJECTION_PROMPT,
    bootstrapInjectionEnabled:
      env.DEEPSEEK_BOOTSTRAP_INJECTION_ENABLED !== '0',
    proxyAuthPath:
      env.PROXY_AUTH_PATH || path.join(process.cwd(), 'proxy-auth.json'),
    proxyRequireAuth:
      env.PROXY_REQUIRE_AUTH === '1' || env.PROXY_REQUIRE_AUTH === 'true',
  };
}

module.exports = {
  DEFAULT_INJECTION_PROMPT,
  getProxyDefaults,
};

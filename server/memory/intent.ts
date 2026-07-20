export function isExplicitMemorySaveRequest(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return /(?:请|帮我|替我|宝宝)?(?:记住|记一下|记下来|存一下|存好|存下来|存下|存起来|存进|存入|保存(?:到)?|写进)/u.test(text)
    || /(?:可以|能不能|麻烦|请|帮我|替我).{0,16}(?:现在)?存(?:下|起来|进去|入)?(?:吧|一下)?/u.test(text)
    || /(?:把|将).{1,160}(?:现在)?(?:存下|存进|存入|保存|写进|存)(?:到|进)?(?:深海某处|记忆|记忆库)(?:吧|一下)?/u.test(text);
}

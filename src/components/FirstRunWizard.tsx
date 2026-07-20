export function FirstRunWizard({ onUseMock, onConnect }: { onUseMock: () => void; onConnect: () => void }) {
  return <div className="onboarding-backdrop"><section className="onboarding-card" aria-label="欢迎来到 Ocean"><div className="onboarding-mark">✦</div><p className="eyebrow">FISH WITH OCTOPUS</p><h1>欢迎回家</h1><p>Ocean 可以连接你的模型、记忆库和网关。现在可以先使用演示数据看看房子，再慢慢接入真实服务。</p><button className="onboarding-primary" onClick={onUseMock}>先看看演示房子</button><button className="onboarding-secondary" onClick={onConnect}>开始连接</button><small>主题和壁纸始终在左侧皮肤栏管理。</small></section></div>;
}

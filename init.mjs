import { execSync } from 'child_process';

console.log(">>> 1. 正在检查并安装依赖...");
try {
  execSync('npm install', { stdio: 'inherit' });

  console.log(">>> 2. 运行静态类型检查与 Linter (Level 0)...");
  // 即使其中一个失败，我们也捕获它并显示错误
  execSync('npm run lint', { stdio: 'inherit' });
  execSync('npm run typecheck', { stdio: 'inherit' });

  console.log(">>> 3. 尝试构建项目以验证编译...");
  execSync('npm run build', { stdio: 'inherit' });

  console.log(">>> 🎉 环境就绪，应用健康。导演，可以开机了！");
} catch (error) {
  console.error("\n❌ 检查失败！请先修复上述报错信息。");
  process.exit(1);
}
# 分镜网站项目宪法 (Project Bible)

## 1. 审美与视觉 (Cinematic Alchemist)
- **视觉核心**：严格遵循项目根目录下的 `DESIGN.md` 规范。
- **禁令**：**绝对禁止使用 1px 实线边框**。必须通过色调切换 (Tonal Shifts) 或负空间 (Negative Space) 来划分区域。
- **色彩**：使用 `#0e0e0e` 作为底色，强调琥珀色 (`#ffb866`) 的“Pixar 发光感”。
- **文字**：严禁使用纯白色 (#FFFFFF)，必须使用 `#e5e2e1` 以维持电影感沉浸感。

## 2. 技术栈 (Tech Stack)
- React 19 + Vite 6 + TypeScript
- Tailwind CSS 4 (@tailwindcss/vite)
- Zustand (状态管理) + Framer Motion (动效)
- 后端：Supabase (Auth & Storage)

## 3. 核心约束 (Strict Rules)
- 严禁删除现有注释。
- 严禁在没有运行 `node init.mjs` 验证通过前宣布成功。
- 严禁一次性重写超过 100 行的代码块。
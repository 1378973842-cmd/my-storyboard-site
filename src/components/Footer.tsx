import React from 'react';
import { BRAND_LOGO_SRC, BRAND_NAME } from './StudioBrand';

export const Footer = () => {
  return (
    <footer className="relative py-14 md:py-20 px-6 md:px-10 lg:px-12 cover-tools-section">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(255,220,180,0.15)] to-transparent pointer-events-none" />
      <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
        <div className="space-y-2 text-center sm:text-left">
          <p className="cover-tools-headline inline-flex items-center justify-center sm:justify-start gap-2.5 text-[15px] font-semibold tracking-[0.03em]">
            <img
              src={BRAND_LOGO_SRC}
              alt=""
              width={28}
              height={28}
              className="studio-brand-mark-logo"
              draggable={false}
            />
            {BRAND_NAME}
          </p>
          <p className="cover-tools-subhead text-[13px] leading-relaxed max-w-sm mx-auto sm:mx-0">
            为动画与视觉叙事而设的个人创作空间。
          </p>
        </div>
        <p className="cover-tools-index text-[12px] text-center sm:text-right normal-case tracking-normal">
          © {new Date().getFullYear()} {BRAND_NAME}
        </p>
      </div>
    </footer>
  );
};

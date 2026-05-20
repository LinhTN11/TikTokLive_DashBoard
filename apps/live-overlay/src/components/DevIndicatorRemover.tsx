'use strict';
'use client';

import { useEffect } from 'react';

export function DevIndicatorRemover() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;

    const hide = () => {
      const targets = [
        'next-route-announcer',
        '#__next-build-watcher',
        '[data-nextjs-toast-wrapper]',
        '.nextjs-static-indicator-base',
        '#nextjs-dev-indicator',
        '.nextjs-portal',
        'nextjs-portal'
      ];
      
      targets.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
            if (el instanceof HTMLElement) {
                el.style.display = 'none';
                el.style.visibility = 'hidden';
            }
            el.remove();
        });
      });
    };

    // Run immediately
    hide();

    // Watch for new elements
    const observer = new MutationObserver(hide);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}

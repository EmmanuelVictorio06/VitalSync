import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from './ui';

type RevealDirection = 'up' | 'down' | 'left' | 'right' | 'none';

const directionVars: Record<RevealDirection, CSSProperties> = {
  up: { '--scroll-reveal-y': '24px' } as CSSProperties,
  down: { '--scroll-reveal-y': '-18px' } as CSSProperties,
  left: { '--scroll-reveal-x': '24px' } as CSSProperties,
  right: { '--scroll-reveal-x': '-24px' } as CSSProperties,
  none: { '--scroll-reveal-y': '0px' } as CSSProperties,
};

export function ScrollReveal({
  children,
  delay = 0,
  direction = 'up',
  className,
  once = true,
}: {
  children: ReactNode;
  delay?: number;
  direction?: RevealDirection;
  className?: string;
  once?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;

        setVisible(entry.isIntersecting);

        if (entry.isIntersecting && once) {
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.16 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [once]);

  return (
    <div
      ref={ref}
      className={cn('scroll-reveal', visible && 'is-visible', className)}
      style={{
        ...directionVars[direction],
        '--scroll-reveal-delay': `${delay}ms`,
      } as CSSProperties}
    >
      {children}
    </div>
  );
}

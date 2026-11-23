import { useState } from 'react';

interface StudentAvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
}

export function StudentAvatar({ name, src, size = 'md' }: StudentAvatarProps) {
  const [hasError, setHasError] = useState(false);

  const sizeClass =
    size === 'sm'
      ? 'w-8 h-8 text-xs'
      : size === 'lg'
        ? 'w-16 h-16 text-lg'
        : 'w-10 h-10 text-sm';

  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  if (!src || hasError) {
    return (
      <div
        aria-label={name}
        className={`${sizeClass} rounded-lg bg-slate-200 text-slate-700 font-display font-semibold flex items-center justify-center shrink-0 border border-slate-300/70 select-none`}
      >
        {initials || 'ST'}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Portrait of ${name}`}
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={`${sizeClass} rounded-lg object-cover shrink-0 border border-slate-200 bg-slate-100`}
    />
  );
}

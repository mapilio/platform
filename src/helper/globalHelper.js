export const getCookie = (name) => {
  if (typeof document === 'undefined') return '';
  const prefix = `${name}=`;
  const parts = decodeURIComponent(document.cookie).split(';');
  for (const part of parts) {
    const c = part.trimStart();
    if (c.startsWith(prefix)) return c.slice(prefix.length);
  }
  return '';
};

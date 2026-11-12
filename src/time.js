export const TZ = 'Europe/Moscow';
export const dayKey = (d) => new Date(d).toLocaleDateString('sv-SE', { timeZone: TZ });
export const hhmm = (d) => new Date(d).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
export const dayMonth = (d) => new Date(d).toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit' });
export const stamp = (d) => `${dayMonth(d)} ${hhmm(d)}`;

/** 界面上的作者。事件里的 lead 显示成术语表里的名字，不发明「代理」。 */
export function shownAuthor(author: string): string {
  if (author === 'lead') return '协调 Agent';
  return author;
}

import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

export function extractContent(html: string, selector: string, asMarkdown: boolean): string {
  const $ = cheerio.load(html);
  const content = $(selector);
  if (!content.length) return '';

  content.find('nav, header, footer, script, style').remove();

  if (asMarkdown) {
    return td.turndown(content.html() ?? '').trim();
  }
  return content.text().replace(/\s+/g, ' ').trim();
}

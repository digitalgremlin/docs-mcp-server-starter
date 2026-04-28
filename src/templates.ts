interface TemplateConfig {
  url: string;
  sitemapUrl: string | null; // null = use discovery
  contentSelector: string;
}

const TEMPLATES: Record<string, TemplateConfig> = {
  nextjs: {
    url: 'https://nextjs.org/docs',
    sitemapUrl: null,
    contentSelector: 'article',
  },
  tailwind: {
    url: 'https://tailwindcss.com/docs',
    sitemapUrl: null,
    contentSelector: '#content',
  },
  react: {
    url: 'https://react.dev/reference',
    sitemapUrl: null,
    contentSelector: 'article',
  },
  typescript: {
    url: 'https://www.typescriptlang.org/docs',
    sitemapUrl: null,
    contentSelector: 'article',
  },
  prisma: {
    url: 'https://www.prisma.io/docs',
    sitemapUrl: null,
    contentSelector: 'article',
  },
};

export function resolveTemplate(id: string): TemplateConfig | null {
  return TEMPLATES[id] ?? null;
}

export function templateIds(): string[] {
  return Object.keys(TEMPLATES);
}

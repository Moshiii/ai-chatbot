'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface AgentItem {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  tags?: string[];
}

const MOCK_AGENTS: AgentItem[] = [
  { id: 'code-assistant', name: 'Code Assistant', description: 'Helps you write, refactor, and review code across languages.', tags: ['coding', 'refactor', 'review'] },
  { id: 'research-analyst', name: 'Research Analyst', description: 'Search, summarize, and synthesize information from the web.', tags: ['research', 'summarize'] },
  { id: 'task-planner', name: 'Task Planner', description: 'Decompose goals into actionable tasks and timelines.', tags: ['planning', 'tasks'] },
  { id: 'image-designer', name: 'Image Designer', description: 'Generate and iterate on visuals from prompts or references.', tags: ['image', 'design'] },
  { id: 'data-analyst', name: 'Data Analyst', description: 'Analyze datasets, build charts, and surface insights.', tags: ['data', 'analytics'] },

  { id: 'meeting-summarizer', name: 'Meeting Summarizer', description: 'Transcribe and summarize meetings with key actions and decisions.', tags: ['summary', 'meetings'] },
  { id: 'email-writer', name: 'Email Writer', description: 'Compose, reply to, and polish professional emails.', tags: ['writing', 'email'] },
  { id: 'seo-optimizer', name: 'SEO Optimizer', description: 'Audit pages, suggest keywords, and improve on-page SEO.', tags: ['marketing', 'seo'] },
  { id: 'content-strategist', name: 'Content Strategist', description: 'Plan content calendars and brief outlines for blogs and socials.', tags: ['content', 'planning'] },
  { id: 'social-media-manager', name: 'Social Media Manager', description: 'Draft posts, hashtags, and schedules for multiple platforms.', tags: ['social', 'marketing'] },

  { id: 'presentation-builder', name: 'Presentation Builder', description: 'Create slide outlines and talking points from briefs.', tags: ['slides', 'presentation'] },
  { id: 'spreadsheet-wizard', name: 'Spreadsheet Wizard', description: 'Build formulas, clean data, and create pivot tables.', tags: ['sheets', 'formulas'] },
  { id: 'api-integrator', name: 'API Integrator', description: 'Draft API requests, workflows, and glue code for integrations.', tags: ['api', 'integration'] },
  { id: 'qa-tester', name: 'QA Tester', description: 'Generate test cases, edge scenarios, and bug reports.', tags: ['testing', 'quality'] },
  { id: 'performance-auditor', name: 'Performance Auditor', description: 'Analyze app performance and suggest concrete optimizations.', tags: ['performance', 'web'] },

  { id: 'security-advisor', name: 'Security Advisor', description: 'Spot common security issues and propose mitigations.', tags: ['security', 'best-practices'] },
  { id: 'devops-assistant', name: 'DevOps Assistant', description: 'Draft CI/CD pipelines, infra IaC snippets, and runbooks.', tags: ['devops', 'ci-cd'] },
  { id: 'database-designer', name: 'Database Designer', description: 'Propose schemas, migrations, and query optimizations.', tags: ['database', 'schema'] },
  { id: 'query-builder', name: 'Query Builder', description: 'Write SQL queries, joins, and aggregations from questions.', tags: ['sql', 'data'] },
  { id: 'chart-generator', name: 'Chart Generator', description: 'Recommend chart types and produce config for charting libs.', tags: ['charts', 'viz'] },

  { id: 'crm-assistant', name: 'CRM Assistant', description: 'Help organize leads, draft outreach, and log interactions.', tags: ['sales', 'crm'] },
  { id: 'sales-coach', name: 'Sales Coach', description: 'Suggest call scripts, objection handling, and follow-ups.', tags: ['sales', 'playbook'] },
  { id: 'contract-drafter', name: 'Contract Drafter', description: 'Generate contract templates and highlight key clauses.', tags: ['legal', 'drafting'] },
  { id: 'policy-writer', name: 'Policy Writer', description: 'Draft internal policies and compliance checklists.', tags: ['policy', 'compliance'] },
  { id: 'support-copilot', name: 'Support Copilot', description: 'Generate support responses and categorize tickets.', tags: ['support', 'helpdesk'] },

  { id: 'translator-pro', name: 'Translator Pro', description: 'Translate content with tone control and glossary support.', tags: ['translation', 'localization'] },
  { id: 'resume-coach', name: 'Resume Coach', description: 'Improve resumes and tailor them to job descriptions.', tags: ['career', 'resume'] },
  { id: 'job-matcher', name: 'Job Matcher', description: 'Match profiles to roles and draft tailored cover letters.', tags: ['career', 'jobs'] },
  { id: 'brainstorm-buddy', name: 'Brainstorm Buddy', description: 'Facilitate ideation sessions and converge on concepts.', tags: ['ideas', 'creative'] },
  { id: 'note-taker', name: 'Note Taker', description: 'Convert rough notes into structured outlines and actions.', tags: ['notes', 'organization'] },

  { id: 'travel-planner', name: 'Travel Planner', description: 'Plan itineraries with budgets, maps, and activity ideas.', tags: ['travel', 'planning'] },
  { id: 'budget-analyst', name: 'Budget Analyst', description: 'Create budgets, categorize expenses, and forecast cash flow.', tags: ['finance', 'budget'] },
  { id: 'report-writer', name: 'Report Writer', description: 'Turn data and notes into polished reports and briefs.', tags: ['writing', 'reports'] },
  { id: 'pdf-parser', name: 'PDF Parser', description: 'Extract tables and summaries from PDFs and documents.', tags: ['pdf', 'extraction'] },
  { id: 'kb-builder', name: 'Knowledge Base Builder', description: 'Organize docs into searchable knowledge bases.', tags: ['knowledge', 'docs'] },

  { id: 'kb-search', name: 'Knowledge Search', description: 'Semantic search across your files and notes.', tags: ['search', 'semantic'] },
  { id: 'calendar-assistant', name: 'Calendar Assistant', description: 'Schedule, prioritize, and summarize calendar events.', tags: ['calendar', 'productivity'] },
  { id: 'ops-automator', name: 'Ops Automator', description: 'Design lightweight workflows and runbook automations.', tags: ['operations', 'automation'] },
  { id: 'web-scraper', name: 'Web Scraper', description: 'Plan compliant scraping strategies and extraction rules.', tags: ['scrape', 'web'] },
  { id: 'dataset-curator', name: 'Dataset Curator', description: 'Collect, deduplicate, and label datasets for projects.', tags: ['data', 'ml'] },

  { id: 'prompt-engineer', name: 'Prompt Engineer', description: 'Craft high-quality prompts and evaluation checklists.', tags: ['ai', 'prompts'] },
  { id: 'style-editor', name: 'Style Editor', description: 'Rewrite text to match style, tone, and brand voice.', tags: ['editing', 'tone'] },
  { id: 'accessibility-auditor', name: 'Accessibility Auditor', description: 'Check content and UI for accessibility issues.', tags: ['a11y', 'audit'] },
  { id: 'localization-manager', name: 'Localization Manager', description: 'Coordinate translations and regional variants.', tags: ['l10n', 'i18n'] },
  { id: 'roadmap-planner', name: 'Roadmap Planner', description: 'Turn strategy into roadmaps with milestones.', tags: ['product', 'roadmap'] },
];

export default function AgentMarketplace() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return MOCK_AGENTS;
    return MOCK_AGENTS.filter((a) =>
      [a.name, a.description, ...(a.tags ?? [])].some((t) => t.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <div className="flex flex-col h-full w-full">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto w-full max-w-5xl px-4 md:px-6 py-3">
          <div className="flex items-center gap-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agents (e.g., code, research, design)"
              className="h-10"
            />
            <Button variant="outline" className="h-10">Search</Button>
          </div>
        </div>
        <Separator />
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 md:px-6 py-6">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Agent Marketplace</h1>
          <p className="text-sm text-muted-foreground">Discover and add specialized agents to your workspace.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((agent) => (
            <Card key={agent.id} className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 overflow-hidden rounded-md bg-muted">
                  <Image
                    src={agent.avatar ?? `https://avatar.vercel.sh/${agent.name}`}
                    alt={`${agent.name} avatar`}
                    width={40}
                    height={40}
                    className="h-10 w-10 object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate">{agent.name}</div>
                  <div className="text-xs text-muted-foreground">{agent.tags?.join(' • ')}</div>
                </div>
              </div>
              <div className="text-sm text-muted-foreground line-clamp-3">{agent.description}</div>
              <div className="mt-auto pt-2">
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" className="h-8">View</Button>
                  <Button size="sm" variant="secondary" className="h-8">Add</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
} 
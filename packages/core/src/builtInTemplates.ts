/// <reference path="./raw.d.ts" />
// Templates da extensão (spec 04): os .md de packages/core/templates/<língua>/, como texto.
// Fora do index do core para o webview não levá-los: quem usa importa este arquivo direto.
// Templates de site em templates/<língua>/sites/<id>/: o template.yml e os arquivos dele (TP11).
// Arquivo novo em templates/ entra aqui (o teste confere que nenhum ficou de fora).
import adrEn from '../templates/en/adr.md?raw';
import apiReferenceEn from '../templates/en/api-reference.md?raw';
import architectureEn from '../templates/en/architecture.md?raw';
import goldenPathEn from '../templates/en/golden-path.md?raw';
import guideEn from '../templates/en/guide.md?raw';
import onboardingEn from '../templates/en/onboarding.md?raw';
import operationsEn from '../templates/en/operations.md?raw';
import postmortemEn from '../templates/en/postmortem.md?raw';
import runbookEn from '../templates/en/runbook.md?raw';
import serviceHomeEn from '../templates/en/service-home.md?raw';
import troubleshootingEn from '../templates/en/troubleshooting.md?raw';
import tutorialEn from '../templates/en/tutorial.md?raw';
import wikiPageEn from '../templates/en/wiki-page.md?raw';
import adrPt from '../templates/pt-br/adr.md?raw';
import apiReferencePt from '../templates/pt-br/api-reference.md?raw';
import architecturePt from '../templates/pt-br/architecture.md?raw';
import goldenPathPt from '../templates/pt-br/golden-path.md?raw';
import guidePt from '../templates/pt-br/guide.md?raw';
import onboardingPt from '../templates/pt-br/onboarding.md?raw';
import operationsPt from '../templates/pt-br/operations.md?raw';
import postmortemPt from '../templates/pt-br/postmortem.md?raw';
import runbookPt from '../templates/pt-br/runbook.md?raw';
import serviceHomePt from '../templates/pt-br/service-home.md?raw';
import troubleshootingPt from '../templates/pt-br/troubleshooting.md?raw';
import tutorialPt from '../templates/pt-br/tutorial.md?raw';
import wikiPagePt from '../templates/pt-br/wiki-page.md?raw';
import goldenPathSiteEn from '../templates/en/sites/golden-path/template.yml?raw';
import serviceDocsAdrEn from '../templates/en/sites/service-docs/adr-0001.md?raw';
import serviceDocsSiteEn from '../templates/en/sites/service-docs/template.yml?raw';
import teamWikiGuidesEn from '../templates/en/sites/team-wiki/guides.md?raw';
import teamWikiHomeEn from '../templates/en/sites/team-wiki/home.md?raw';
import teamWikiSiteEn from '../templates/en/sites/team-wiki/template.yml?raw';
import goldenPathSitePt from '../templates/pt-br/sites/golden-path/template.yml?raw';
import serviceDocsAdrPt from '../templates/pt-br/sites/service-docs/adr-0001.md?raw';
import serviceDocsSitePt from '../templates/pt-br/sites/service-docs/template.yml?raw';
import teamWikiGuidesPt from '../templates/pt-br/sites/team-wiki/guides.md?raw';
import teamWikiHomePt from '../templates/pt-br/sites/team-wiki/home.md?raw';
import teamWikiSitePt from '../templates/pt-br/sites/team-wiki/template.yml?raw';

export type TemplateLanguage = 'en' | 'pt-br';

/** Texto de cada template da extensão, por língua e id (nome do arquivo sem `.md`). */
export const BUILT_IN_TEMPLATES: Record<TemplateLanguage, Record<string, string>> = {
  'en': {
    'adr': adrEn,
    'api-reference': apiReferenceEn,
    'architecture': architectureEn,
    'golden-path': goldenPathEn,
    'guide': guideEn,
    'onboarding': onboardingEn,
    'operations': operationsEn,
    'postmortem': postmortemEn,
    'runbook': runbookEn,
    'service-home': serviceHomeEn,
    'troubleshooting': troubleshootingEn,
    'tutorial': tutorialEn,
    'wiki-page': wikiPageEn,
  },
  'pt-br': {
    'adr': adrPt,
    'api-reference': apiReferencePt,
    'architecture': architecturePt,
    'golden-path': goldenPathPt,
    'guide': guidePt,
    'onboarding': onboardingPt,
    'operations': operationsPt,
    'postmortem': postmortemPt,
    'runbook': runbookPt,
    'service-home': serviceHomePt,
    'troubleshooting': troubleshootingPt,
    'tutorial': tutorialPt,
    'wiki-page': wikiPagePt,
  },
};

/** Templates de site da extensão, por língua e id: os arquivos de cada pasta, pelo nome (`template.yml` e os `source`). */
export const BUILT_IN_SITES: Record<TemplateLanguage, Record<string, Record<string, string>>> = {
  'en': {
    'golden-path': { 'template.yml': goldenPathSiteEn },
    'service-docs': { 'template.yml': serviceDocsSiteEn, 'adr-0001.md': serviceDocsAdrEn },
    'team-wiki': { 'template.yml': teamWikiSiteEn, 'home.md': teamWikiHomeEn, 'guides.md': teamWikiGuidesEn },
  },
  'pt-br': {
    'golden-path': { 'template.yml': goldenPathSitePt },
    'service-docs': { 'template.yml': serviceDocsSitePt, 'adr-0001.md': serviceDocsAdrPt },
    'team-wiki': { 'template.yml': teamWikiSitePt, 'home.md': teamWikiHomePt, 'guides.md': teamWikiGuidesPt },
  },
};

/** Língua dos templates pela do VS Code: português para `pt*`, senão inglês (TP9). */
export const templateLanguage = (language: string): TemplateLanguage => (language.toLowerCase().startsWith('pt') ? 'pt-br' : 'en');

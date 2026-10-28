/// <reference path="./raw.d.ts" />
// Templates da extensão (spec 04): os .md de packages/core/templates/<língua>/, como texto.
// Fora do index do core para o webview não levá-los: quem usa importa este arquivo direto.
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

/** Língua dos templates pela do VS Code: português para `pt*`, senão inglês (TP9). */
export const templateLanguage = (language: string): TemplateLanguage => (language.toLowerCase().startsWith('pt') ? 'pt-br' : 'en');

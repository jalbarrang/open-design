import type { Express } from 'express';
import type { SkillInfo } from './skills.js';
import type { DesignSystemSummary } from './design-systems/index.js';
import type { RoutineRoutesService } from './routes/routine.js';
import type { OpenDesignPublicMetadataService } from './services/open-design-public-metadata.js';

export interface HttpDeps {
  createSseResponse: (...args: any[]) => any;
  getPublicBaseUrl?: (...args: any[]) => string;
  isLocalSameOrigin: (...args: any[]) => boolean;
  requireLocalDaemonRequest: (...args: any[]) => any;
  resolvedPortRef: { current: number };
  sendApiError: (...args: any[]) => any;
  sendLiveArtifactRouteError: (...args: any[]) => any;
  sendMulterError: (...args: any[]) => any;
}

export interface PathDeps {
  ARTIFACTS_DIR: string;
  BRANDS_DIR: string;
  BUNDLED_PETS_DIR: string;
  CRAFT_DIR: string;
  DESIGN_SYSTEMS_DIR: string;
  DESIGN_TEMPLATES_DIR: string;
  LIBRARY_DIR: string;
  OD_BIN: string;
  PROJECT_ROOT: string;
  PROJECTS_DIR: string;
  PROMPT_TEMPLATES_DIR: string;
  RUNTIME_DATA_DIR: string;
  RUNTIME_DATA_DIR_CANONICAL: string;
  SKILLS_DIR: string;
  USER_DESIGN_SYSTEMS_DIR: string;
  USER_DESIGN_TEMPLATES_DIR: string;
  USER_SKILLS_DIR: string;
}

export interface ResourceDeps {
  FIRST_PARTY_ATOMS?: Array<any>;
  listAllDesignSystems: () => Promise<Array<DesignSystemSummary & { source?: string }>>;
  listAllSkills: () => Promise<Array<SkillInfo & { source?: string }>>;
  listAllDesignTemplates: () => Promise<Array<SkillInfo & { source?: string }>>;
  listAllSkillLikeEntries: () => Promise<Array<SkillInfo & { source?: string }>>;
  mimeFor: (filePath: string) => string;
}

export interface RoutineDeps {
  routineService: RoutineRoutesService;
}

export interface ProjectPreviewScopeDeps {
  mint: (projectId: string, options?: { readonly ttlMs?: number }) => string;
  revoke: (scope: string) => void;
  expiresAt: (projectId: string, scope: string) => number | undefined;
  renew: (
    projectId: string,
    scope: string,
    options?: { readonly ttlMs?: number },
  ) => number | undefined;
  validate: (projectId: string, scope: string) => boolean;
}

export interface TelemetryDeps {
  reportFinalizedMessage: (
    saved: any,
    body?: any,
    options?: {
      analyticsContext?: any;
      projectId?: string;
      conversationId?: string;
      reportTrigger?: 'final_message' | 'terminal_fallback';
    },
  ) => void;
  reportFeedback?: (req: {
    runId: string;
    rating: 'positive' | 'negative';
    reasonCodes: string[];
    hasCustomReason: boolean;
    customReason: string;
    scoreMetadata?: Record<string, unknown>;
  }) => Promise<{ status: 'accepted' | 'skipped_consent' | 'skipped_no_sink' }>;
  reportRunCompletionTelemetryFallback: (...args: any[]) => any;
  resolveRunProjectKindForAnalytics: (...args: any[]) => any;
  runArtifactBaselines: any;
  runRetryEventsForAnalytics: (...args: any[]) => any;
  captureProductEvent?: (
    req: any,
    eventName: string,
    properties: Record<string, unknown>,
  ) => Promise<void> | void;
}

export interface ServerContext {
  db: any;
  design: any;
  http: HttpDeps;
  paths: PathDeps;
  ids: any;
  uploads: any;
  node: any;
  projectStore: any;
  isApiTokenAuthorization: (authorization: string | undefined) => boolean;
  projectFiles: any;
  conversations: any;
  templates: any;
  status: any;
  events: any;
  imports: any;
  exports: any;
  artifacts: any;
  documents: any;
  auth: any;
  liveArtifacts: any;
  deploy: any;
  media: any;
  appConfig: any;
  orbit: any;
  nativeDialogs: any;
  research: any;
  mcp: any;
  plugins: any;
  pluginScope: any;
  resources: ResourceDeps;
  routines: RoutineDeps;
  projectPreviewScopes: ProjectPreviewScopeDeps;
  telemetry: TelemetryDeps;
  validation: any;
  finalize: any;
  handoff: any;
  chat: any;
  messages: any;
  agents: any;
  critique: any;
  openDesignPublicMetadata: OpenDesignPublicMetadataService;
  lifecycle: {
    isDaemonShuttingDown: () => boolean;
  };
}

export type RouteDeps<K extends keyof ServerContext> = Pick<ServerContext, K>;
export type RouteRegistrar = (app: Express, ctx: ServerContext) => void;

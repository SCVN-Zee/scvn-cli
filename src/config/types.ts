/**
 * config/types.ts — ScvnConfig interface.
 *
 * All fields optional — absence means "not configured".
 * Maps 1:1 to SCVN_* env vars and ~/.scvn/config file keys.
 */

export interface ScvnConfig {
  /** Path to the Unity projects root directory. SCVN_PROJECTS_ROOT */
  projectsRoot?: string;
}

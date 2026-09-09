import type { Scenario } from '@/types/scenario'
import type { Scene, Synopsis, SynopsisNPC, SynopsisFaction } from '@/types/synopsis'
import type {
  CampaignNPC, CampaignLocation, CampaignFaction, CampaignArtefact,
} from '@/types/entities'

/**
 * What `GET /campaigns/:id/print` returns — see backend/internal/handlers/
 * campaign_print.go. One payload for the whole book, so the page is either
 * complete or still loading and never half-painted when the dialog opens.
 */
export interface CampaignPrintScenario {
  scenario: Scenario
  synopsis: Synopsis | null
  scenes: Scene[]
  synopsis_npcs: SynopsisNPC[]
  synopsis_factions: SynopsisFaction[]
}

/**
 * Just the fields the book prints. The endpoint deliberately does not send the
 * whole campaign row — it carries `llm_config`, which can hold an encrypted API
 * key and which a document has no use for.
 */
export interface PrintCampaign {
  id: string
  name: string
  genre: string
  game_name: string
  pitch: string
}

export interface CampaignPrintDoc {
  campaign: PrintCampaign
  scenarios: CampaignPrintScenario[]
  npcs: CampaignNPC[]
  locations: CampaignLocation[]
  factions: CampaignFaction[]
  artefacts: CampaignArtefact[]
}

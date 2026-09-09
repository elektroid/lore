import { Buffer } from 'node:buffer'

/**
 * A campaign rich enough to judge the printed book by: two scenarios with act
 * breaks, prose carrying mentions and bold and lists, and every entity type
 * with a real uploaded picture.
 *
 * Thin seed data flatters a layout. Long names wrap, missing portraits leave
 * holes, an entity mentioned in three scenes has to look right in all of them —
 * none of that shows up in a campaign with one PNJ called "Bob".
 */

/** A deterministic PNG, so the page has real pixels to lay out and decode. */
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = buf => {
    let c = 0xffffffff
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, cr])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  const raw = Buffer.alloc((w * 3 + 1) * h)
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0
    for (let x = 0; x < w; x++) {
      // A soft diagonal gradient, so the crop and the grayscale filter on the
      // cover strip have something to actually show.
      const t = (x / w + y / h) / 2
      raw[o++] = Math.round(r * (0.55 + 0.45 * t))
      raw[o++] = Math.round(g * (0.55 + 0.45 * t))
      raw[o++] = Math.round(b * (0.55 + 0.45 * t))
    }
  }
  const zlib = require('node:zlib')
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

async function upload(api, path, bytes, name) {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: 'image/png' }), name)
  return api.upload(path, form)
}

const mention = (kind, id, name) =>
  kind === 'npc' ? `@[${name}](${id})` : `@[${name}](${kind}:${id})`

export async function seedBook(app) {
  const { api, ids } = app
  const { campaignId } = ids

  await api.put(`/campaigns/${campaignId}`, {
    name: 'Les Cendres de Nyx-9',
    genre: 'Cyberpunk — enquête et braquage',
    game_id: ids.gameId,
    pitch: 'Une station orbitale à l\'abandon, une cargaison que trois pouvoirs '
      + 'veulent récupérer, et un équipage payé par quelqu\'un qui ne dit pas son nom.\n\n'
      + 'Les personnages ont **six jours** avant que la station ne rentre dans '
      + 'l\'atmosphère. Ce qu\'ils choisissent d\'emporter décide de la fin.',
  })

  // ── Cast ──────────────────────────────────────────────────────────────────
  const npcSpecs = [
    ['Rache Velasquez-Oyelaran', 'Fixeuse, ancienne officière de bord',
      'Petite, voûtée, une cicatrice thermique le long de la mâchoire. Parle bas et lentement, '
      + 'comme si chaque phrase coûtait de l\'oxygène.\n\nElle sait où est la cargaison. Elle ne dira pas comment.',
      'Racheter le nom de sa sœur, effacé des registres après l\'incident.',
      'Vous payez pour la porte. Ce qu\'il y a derrière, c\'est un autre contrat.', [198, 74, 60]],
    ['Docteur Ilse Brandt', 'Médecin de bord — sous contrat Hyperion',
      'Grande, méthodique, des gants qu\'elle ne retire jamais. Elle a signé quelque chose '
      + 'qu\'elle regrette.', 'Sortir de la station avec ses dossiers, ou les détruire.',
      'Je soigne. Je ne témoigne pas.', [72, 118, 176]],
    ['Osei', 'Enfant de la coque, guide',
      'Onze ans peut-être. Connaît les conduits mieux que les plans. Ne dort jamais deux fois au même endroit.',
      'Trouver quelqu\'un qui reste.', 'La station respire. Faut juste écouter où.', [96, 158, 108]],
    ['Le Contremaître', 'Voix synthétique du système de fret',
      'Une IA de logistique restée allumée quatorze ans après l\'évacuation. Polie, insistante, '
      + 'convaincue que le quart de nuit va reprendre.', 'Terminer le manifeste.',
      'Le chargement est en retard de cinq mille deux cent onze jours.', [150, 120, 190]],
  ]
  const npcs = []
  for (const [name, role, description, motivation, quote, colour] of npcSpecs) {
    const npc = await api.post(`/campaigns/${campaignId}/npcs`, {
      name, role, description, motivation, quote,
    })
    await upload(api, `/campaigns/${campaignId}/npcs/${npc.id}/images`, png(300, 380, colour), 'portrait.png')
    npcs.push(npc)
  }

  // ── Places ────────────────────────────────────────────────────────────────
  const locSpecs = [
    ['Le Pont Cassé', 'Nyx-9', 'Anneau supérieur',
      'La passerelle de commandement, éventrée côté bâbord. Le vide est derrière une seule vitre, '
      + 'fêlée en toile d\'araignée.', 'Silence, givre, et le bruit d\'une alarme qui n\'a plus de batterie.',
      [70, 92, 120]],
    ['Soute Sept', 'Nyx-9', 'Ventre',
      'Trois mille conteneurs empilés dans le noir, et un seul qui compte.',
      'Chaud, humide, une odeur de fer. On entend les parois travailler.', [140, 100, 62]],
    ['Le Marché de Quai', 'Kaleb Station', 'Docks bas',
      'Là où l\'équipage a été recruté. Bruyant, lumineux, plein de gens qui savent déjà pourquoi ils sont là.',
      'Néon, friture, trop de monde.', [176, 92, 140]],
  ]
  const locations = []
  for (const [name, city, district, description, atmosphere, colour] of locSpecs) {
    const loc = await api.post(`/campaigns/${campaignId}/locations`, { name, city, district, description, atmosphere })
    await upload(api, `/campaigns/${campaignId}/locations/${loc.id}/images`, png(480, 300, colour), 'place.png')
    locations.push(loc)
  }

  // ── Factions ──────────────────────────────────────────────────────────────
  const facSpecs = [
    ['Hyperion Salvage', 'Corporation',
      'Détient le titre de récupération sur l\'épave. Juridiquement irréprochable, méthodiquement brutale.',
      'Récupérer la cargaison sans qu\'aucun tribunal n\'apprenne ce qu\'elle contient.', [60, 90, 150]],
    ['Les Veilleurs', 'Culte de coque',
      'Ce qu\'il reste de l\'équipage d\'origine, et leurs enfants. Ils considèrent la station comme un corps.',
      'Que Nyx-9 brûle intacte plutôt que d\'être dépecée.', [150, 70, 70]],
  ]
  const factions = []
  for (const [name, type, description, motivation, colour] of facSpecs) {
    const f = await api.post(`/campaigns/${campaignId}/factions`, { name, type, description, motivation })
    await upload(api, `/campaigns/${campaignId}/factions/${f.id}/images`, png(400, 240, colour), 'faction.png')
    factions.push(f)
  }

  // ── Props ─────────────────────────────────────────────────────────────────
  const artSpecs = [
    ['La Cargaison', 'Une caisse hermétique en composite gris, neutre, cyberlock, 45 kg. '
      + 'Aucun marquage. Le manifeste la décrit comme « échantillons horticoles ».', [120, 130, 110]],
    ['Carte-clé du Contremaître', 'Ouvre toutes les portes de fret. Signale chaque ouverture.', [190, 160, 60]],
    ['Le registre de Brandt', 'Un carnet papier, ce qui est en soi une déclaration.', [110, 110, 120]],
  ]
  const artefacts = []
  for (const [name, description, colour] of artSpecs) {
    const a = await api.post(`/campaigns/${campaignId}/artefacts`, { name, description })
    await upload(api, `/campaigns/${campaignId}/artefacts/${a.id}/images`, png(320, 200, colour), 'prop.png')
    artefacts.push(a)
  }

  const R = mention('npc', npcs[0].id, npcs[0].name)
  const B = mention('npc', npcs[1].id, npcs[1].name)
  const O = mention('npc', npcs[2].id, npcs[2].name)
  const CARGO = mention('artefact', artefacts[0].id, artefacts[0].name)
  const HYP = mention('faction', factions[0].id, factions[0].name)
  const SOUTE = mention('location', locations[1].id, locations[1].name)

  // ── Scenario one ──────────────────────────────────────────────────────────
  const sc1 = app.ids.scenarioId
  await api.put(`/scenarios/${sc1}`, { name: 'Le contrat', status: 'draft' })
  await api.put(`/scenarios/${sc1}/synopsis`, {
    hook: {
      content: `${R} engage l'équipage au ${mention('location', locations[2].id, locations[2].name)}. `
        + `Le contrat est simple à lire et impossible à tenir : entrer dans Nyx-9, sortir ${CARGO}, `
        + `ne croiser personne.\n\n`
        + `Ce que le contrat ne dit pas :\n`
        + `- ${HYP} a déjà une équipe à bord\n`
        + `- la station est habitée\n`
        + `- **quelqu'un d'autre paie Rache**`,
      status: 'in_progress',
    },
  })
  await api.post(`/scenarios/${sc1}/synopsis/npcs`, { npc_id: npcs[0].id })
  await api.post(`/scenarios/${sc1}/synopsis/npcs`, { npc_id: npcs[2].id })
  await api.post(`/scenarios/${sc1}/synopsis/factions`, { faction_id: factions[0].id })

  const scenes1 = [
    { type: 'divider', title: 'Acte I — Le quai' },
    {
      type: 'scene', title: 'L\'embauche', status: 'key_event', is_start: true,
      location_id: locations[2].id,
      description: `${R} paie une tournée avant de parler travail. Elle a choisi une table d'où l'on voit les deux sorties.\n\n`
        + `Elle donne les grandes lignes, un acompte, et un horaire non négociable.`,
      outcome: 'Les PJ acceptent, ou refusent et se font suivre.',
      notes: `Si on lui demande qui paie, elle change de sujet une fois. Deux fois, elle s'en va.`,
    },
    {
      type: 'scene', title: 'Le briefing qui manque', status: 'optional_step',
      description: `Quelqu'un dans le marché a travaillé sur Nyx-9. Deux heures de questions bien posées valent une carte des ponts.`,
      outcome: 'Un plan partiel de la station, périmé de quatre ans.',
    },
    { type: 'divider', title: 'Acte II — L\'approche' },
    {
      type: 'scene', title: 'Arrimage', status: 'key_event',
      location_id: locations[0].id,
      description: `Le sas supérieur est le seul encore sous pression. ${O} les attend de l'autre côté, assis, comme s'il avait toujours su l'heure.`,
      outcome: 'L\'équipage est à bord, et n\'est pas seul.',
      notes: 'Osei ne se cache pas. Il évalue.',
      is_end: true,
    },
  ]
  for (const [i, s] of scenes1.entries()) {
    const scene = await api.post(`/scenarios/${sc1}/synopsis/scenes`, {
      type: s.type, sort_order: i, title: s.title,
    })
    if (s.type === 'divider') continue
    await api.put(`/scenarios/${sc1}/synopsis/scenes/${scene.id}`, {
      title: s.title, status: s.status ?? 'idea', description: s.description ?? '',
      outcome: s.outcome ?? '', notes: s.notes ?? '',
      location_id: s.location_id ?? '', is_start: !!s.is_start, is_end: !!s.is_end,
    })
    if (s.title === 'L\'embauche') {
      await api.post(`/scenarios/${sc1}/synopsis/scenes/${scene.id}/npcs`, { npc_id: npcs[0].id })
    }
    if (s.title === 'Arrimage') {
      await api.post(`/scenarios/${sc1}/synopsis/scenes/${scene.id}/npcs`, { npc_id: npcs[2].id })
      await api.post(`/scenarios/${sc1}/synopsis/scenes/${scene.id}/artefacts`, { artefact_id: artefacts[1].id })
    }
  }

  // ── Scenario two ──────────────────────────────────────────────────────────
  const sc2 = await api.post(`/campaigns/${campaignId}/scenarios`, { name: 'Six jours', description: '' })
  await api.put(`/scenarios/${sc2.id}/synopsis`, {
    hook: {
      content: `La station rentre dans l'atmosphère dans six jours. ${CARGO} est en ${SOUTE}, `
        + `et ${B} refuse de dire pourquoi elle est restée à bord.`,
      status: 'draft',
    },
  })
  await api.post(`/scenarios/${sc2.id}/synopsis/npcs`, { npc_id: npcs[1].id })
  await api.post(`/scenarios/${sc2.id}/synopsis/npcs`, { npc_id: npcs[3].id })
  await api.post(`/scenarios/${sc2.id}/synopsis/factions`, { faction_id: factions[1].id })

  const scenes2 = [
    {
      type: 'scene', title: 'Soute Sept', status: 'key_event', is_start: true,
      location_id: locations[1].id,
      description: `Trois mille conteneurs. Le manifeste du ${mention('npc', npcs[3].id, npcs[3].name)} donne une allée et un rang, tous les deux faux.`,
      outcome: 'La cargaison est trouvée — ou l\'équipe de Hyperion la trouve d\'abord.',
      notes: 'Le Contremaître aide volontiers. Il signale aussi chaque ouverture.',
    },
    {
      type: 'scene', title: 'Ce que Brandt n\'a pas brûlé', status: 'idea',
      description: `Une infirmerie encore alimentée, et quelqu'un dedans.`,
      outcome: '',
      notes: 'À développer.',
    },
    {
      type: 'scene', title: 'Rentrée', status: 'key_event', is_end: true,
      description: `Six jours plus tard. Ce qui est à bord brûle avec la station.`,
      outcome: 'Ce que l\'équipage a choisi d\'emporter décide de la fin.',
    },
  ]
  for (const [i, s] of scenes2.entries()) {
    const scene = await api.post(`/scenarios/${sc2.id}/synopsis/scenes`, {
      type: s.type, sort_order: i, title: s.title,
    })
    await api.put(`/scenarios/${sc2.id}/synopsis/scenes/${scene.id}`, {
      title: s.title, status: s.status, description: s.description,
      outcome: s.outcome, notes: s.notes ?? '',
      location_id: s.location_id ?? '', is_start: !!s.is_start, is_end: !!s.is_end,
    })
    if (s.title === 'Soute Sept') {
      await api.post(`/scenarios/${sc2.id}/synopsis/scenes/${scene.id}/npcs`, { npc_id: npcs[3].id })
      await api.post(`/scenarios/${sc2.id}/synopsis/scenes/${scene.id}/artefacts`, { artefact_id: artefacts[0].id })
    }
  }

  return { npcs, locations, factions, artefacts, scenarioIds: [sc1, sc2.id] }
}

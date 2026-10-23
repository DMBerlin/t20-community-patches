// Tormenta20 1.6.5 compendium entries relevant to race-data, as toObject() returns them in Foundry 14.369 (sources
// cleaned by the schema). Descriptions are replaced by placeholders.
export const MINOTAURO = {
  "name": "Minotauro",
  "type": "race",
  "img": "systems/tormenta20/icons/racas/minotauro.webp",
  "system": {
    "description": {
      "value": "<p>placeholder</p>"
    },
    "source": "",
    "origin": "",
    "tags": [],
    "rolltags": [],
    "chatFlavor": "",
    "chatGif": "",
    "atributos": {
      "for": 2,
      "des": 1,
      "con": 0,
      "int": 0,
      "sab": -1,
      "car": 0
    },
    "atributosDinamicos": {
      "value": [],
      "description": "+1 em Três Atributos Diferentes"
    },
    "grants": [
      {
        "title": "",
        "desc": "",
        "type": "multi",
        "choices": [
          {
            "uuid": "Compendium.tormenta20.poderes.Item.ebkvViYlLzxFy8XO"
          },
          {
            "uuid": "Compendium.tormenta20.poderes.Item.R4mqRNcLHRzrqLly"
          },
          {
            "uuid": "Compendium.tormenta20.poderes.Item.KuNWTgJXHsg6tfzy"
          },
          {
            "uuid": "Compendium.tormenta20.poderes.Item.xn9RfAp79NWrXSYI"
          }
        ]
      }
    ],
    "automationtags": [],
    "skills": []
  },
  "effects": [],
  "folder": null,
  "ownership": {
    "default": 0
  },
  "flags": {},
  "_stats": {
    "duplicateSource": null,
    "exportSource": null,
    "coreVersion": "14.366",
    "systemId": "tormenta20",
    "systemVersion": "1.6.0",
    "createdTime": 1788042553945,
    "modifiedTime": 1788042553945,
    "lastModifiedBy": "4fJviA1Q4qcjwsna",
    "compendiumSource": null
  },
  "_id": "UknA6Hsp6YvqPuuA",
  "sort": 600000
};

export const PEQUENO_E_RECHONCHUDO = {
  "_id": "fLezjAZcNHYRx7rV",
  "name": "Pequeno e Rechonchudo",
  "type": "poder",
  "img": "systems/tormenta20/icons/racas/hynne.webp",
  "effects": [
    {
      "origin": "Item.fLezjAZcNHYRx7rV",
      "tint": "#ffffff",
      "flags": {
        "tormenta20": {}
      },
      "duration": {
        "value": null,
        "units": "seconds",
        "expiry": null,
        "expired": false
      },
      "disabled": false,
      "_id": "HI65tXsIJK8edUPr",
      "transfer": true,
      "_stats": {
        "coreVersion": "14.366",
        "systemId": "tormenta20",
        "systemVersion": "1.6.0",
        "createdTime": 1788042525115,
        "modifiedTime": 1788042525115,
        "lastModifiedBy": "4fJviA1Q4qcjwsna",
        "compendiumSource": null,
        "duplicateSource": null,
        "exportSource": null
      },
      "name": "Pequeno e Rechonchudo",
      "img": "systems/tormenta20/icons/racas/hynne.webp",
      "type": "base",
      "system": {
        "changes": [
          {
            "key": "system.pericias.enga.bonus",
            "value": 2,
            "priority": null,
            "type": "add",
            "phase": "initial"
          }
        ],
        "targets": [],
        "status": null,
        "onuse": false,
        "abilityUse": {
          "description": "",
          "automatic": false,
          "aumenta": false,
          "custo": 0,
          "names": [],
          "types": []
        },
        "aura": {
          "isAura": false,
          "range": 0
        },
        "identifier": "",
        "upgrade": {
          "type": null,
          "itemType": []
        }
      },
      "description": "",
      "statuses": [],
      "sort": 0,
      "start": null,
      "showIcon": 1,
      "folder": null
    }
  ],
  "folder": "5QQ32VlTEvkqmLdn",
  "sort": 0,
  "flags": {},
  "system": {
    "description": {
      "value": "<p>placeholder</p>"
    },
    "source": "Tormenta20 — Edição Jogo do Ano, p. 28",
    "ativacao": {
      "execucao": "passive",
      "custo": 0,
      "qtd": "",
      "condicao": "",
      "special": ""
    },
    "duracao": {
      "value": 0,
      "units": "inst",
      "special": ""
    },
    "range": {
      "value": null,
      "units": ""
    },
    "efeito": "",
    "alcance": "none",
    "area": "",
    "resistencia": {
      "pericia": "",
      "atributo": "sab",
      "bonus": 0,
      "txt": ""
    },
    "rolls": [],
    "tipo": "racial",
    "subtipo": "Hynne",
    "origin": "",
    "tags": [],
    "chatFlavor": "",
    "chatGif": "",
    "rolltags": [],
    "automationtags": []
  },
  "ownership": {
    "default": 0
  },
  "_stats": {
    "systemId": "tormenta20",
    "systemVersion": "1.6.0",
    "coreVersion": "14.366",
    "createdTime": 1788042525115,
    "modifiedTime": 1788042525115,
    "lastModifiedBy": "4fJviA1Q4qcjwsna",
    "duplicateSource": null,
    "exportSource": null,
    "compendiumSource": null
  }
};

export const CONHECIMENTO_DAS_ROCHAS = {
  "_id": "726XcodKEzHaBYI7",
  "name": "Conhecimento das Rochas",
  "type": "poder",
  "img": "systems/tormenta20/icons/racas/anao.webp",
  "effects": [
    {
      "_id": "iEaedpKQzm09vOEX",
      "disabled": true,
      "duration": {
        "value": null,
        "units": "seconds",
        "expiry": null,
        "expired": false
      },
      "origin": "Item.Cw9woSVDEMjIwOnI",
      "transfer": true,
      "flags": {
        "tormenta20": {}
      },
      "tint": "#ffffff",
      "_stats": {
        "coreVersion": "14.366",
        "systemId": "tormenta20",
        "systemVersion": "1.6.0",
        "createdTime": 1788042525108,
        "modifiedTime": 1788042525108,
        "lastModifiedBy": "4fJviA1Q4qcjwsna",
        "compendiumSource": null,
        "duplicateSource": null,
        "exportSource": null
      },
      "name": "Conhecimento das Rochas",
      "img": "icons/svg/upgrade.svg",
      "type": "base",
      "system": {
        "changes": [
          {
            "key": "roll",
            "value": 2,
            "priority": 0,
            "type": "add",
            "phase": "initial"
          }
        ],
        "targets": [],
        "status": null,
        "onuse": true,
        "abilityUse": {
          "description": "",
          "automatic": false,
          "aumenta": false,
          "custo": null,
          "names": [
            "Percepção",
            "Sobrevivência"
          ],
          "types": [
            "skill"
          ]
        },
        "aura": {
          "isAura": false,
          "range": 0
        },
        "identifier": "",
        "upgrade": {
          "type": null,
          "itemType": []
        }
      },
      "description": "",
      "statuses": [],
      "sort": 0,
      "start": null,
      "showIcon": 1,
      "folder": null
    }
  ],
  "folder": "QXmpsdR2yksENTdS",
  "sort": 0,
  "flags": {},
  "system": {
    "description": {
      "value": "<p>placeholder</p>"
    },
    "source": "Tormenta20 — Edição Jogo do Ano, p. 20",
    "ativacao": {
      "execucao": "passive",
      "custo": 0,
      "qtd": "",
      "condicao": "",
      "special": ""
    },
    "duracao": {
      "value": 0,
      "units": "inst",
      "special": ""
    },
    "range": {
      "value": null,
      "units": ""
    },
    "efeito": "",
    "alcance": "none",
    "area": "",
    "resistencia": {
      "pericia": "",
      "atributo": "sab",
      "bonus": 0,
      "txt": ""
    },
    "rolls": [],
    "tipo": "racial",
    "subtipo": "Anão",
    "chatFlavor": "",
    "origin": "",
    "tags": [],
    "chatGif": "",
    "rolltags": [],
    "automationtags": []
  },
  "ownership": {
    "default": 0
  },
  "_stats": {
    "systemId": "tormenta20",
    "systemVersion": "1.6.0",
    "coreVersion": "14.366",
    "createdTime": 1788042525108,
    "modifiedTime": 1788042525108,
    "lastModifiedBy": "4fJviA1Q4qcjwsna",
    "duplicateSource": null,
    "exportSource": null,
    "compendiumSource": null
  }
};

export const SENTIDOS_ELFICOS = {
  "_id": "PEn3CaxnaMEIAXUR",
  "name": "Sentidos Élficos",
  "type": "poder",
  "img": "systems/tormenta20/icons/racas/elfo.webp",
  "effects": [
    {
      "origin": "Item.PEn3CaxnaMEIAXUR",
      "tint": "#ffffff",
      "flags": {
        "tormenta20": {}
      },
      "duration": {
        "value": null,
        "units": "seconds",
        "expiry": null,
        "expired": false
      },
      "disabled": false,
      "_id": "WoYZYSubI5fTCYrg",
      "transfer": true,
      "_stats": {
        "coreVersion": "14.366",
        "systemId": "tormenta20",
        "systemVersion": "1.6.0",
        "createdTime": 1788042525112,
        "modifiedTime": 1788042525112,
        "lastModifiedBy": "4fJviA1Q4qcjwsna",
        "compendiumSource": null,
        "duplicateSource": null,
        "exportSource": null
      },
      "name": "Sentidos Élficos",
      "img": "systems/tormenta20/icons/racas/elfo.webp",
      "type": "base",
      "system": {
        "changes": [
          {
            "key": "system.pericias.mist.bonus",
            "value": 2,
            "priority": null,
            "type": "add",
            "phase": "initial"
          },
          {
            "key": "system.pericias.perc.bonus",
            "value": 2,
            "priority": null,
            "type": "add",
            "phase": "initial"
          }
        ],
        "targets": [],
        "status": null,
        "onuse": false,
        "abilityUse": {
          "description": "",
          "automatic": false,
          "aumenta": false,
          "custo": 0,
          "names": [],
          "types": []
        },
        "aura": {
          "isAura": false,
          "range": 0
        },
        "identifier": "",
        "upgrade": {
          "type": null,
          "itemType": []
        }
      },
      "description": "",
      "statuses": [],
      "sort": 0,
      "start": null,
      "showIcon": 1,
      "folder": null
    }
  ],
  "folder": "sP6NJ3uhryFkjai6",
  "sort": 0,
  "flags": {},
  "system": {
    "description": {
      "value": "<p>placeholder</p>"
    },
    "source": "Tormenta20 — Edição Jogo do Ano, p. 22",
    "ativacao": {
      "execucao": "passive",
      "custo": 0,
      "qtd": "",
      "condicao": "",
      "special": ""
    },
    "duracao": {
      "value": 0,
      "units": "inst",
      "special": ""
    },
    "range": {
      "value": null,
      "units": ""
    },
    "efeito": "",
    "alcance": "none",
    "area": "",
    "resistencia": {
      "pericia": "",
      "atributo": "sab",
      "bonus": 0,
      "txt": ""
    },
    "rolls": [],
    "tipo": "racial",
    "subtipo": "Elfo",
    "origin": "",
    "tags": [],
    "chatFlavor": "",
    "chatGif": "",
    "rolltags": [],
    "automationtags": []
  },
  "ownership": {
    "default": 0
  },
  "_stats": {
    "systemId": "tormenta20",
    "systemVersion": "1.6.0",
    "coreVersion": "14.366",
    "createdTime": 1788042525111,
    "modifiedTime": 1788042525111,
    "lastModifiedBy": "4fJviA1Q4qcjwsna",
    "duplicateSource": null,
    "exportSource": null,
    "compendiumSource": null
  }
};

export const PESTE_ESGUIA = {
  "_id": "y0onvqs27lHcbJK5",
  "name": "Peste Esguia",
  "type": "poder",
  "img": "systems/tormenta20/icons/racas/goblin.webp",
  "effects": [
    {
      "_id": "ehybDa2i9Kvt1dkd",
      "disabled": false,
      "duration": {
        "value": null,
        "units": "seconds",
        "expiry": null,
        "expired": false
      },
      "origin": "Item.MqcETRAFEr4mNDGU",
      "transfer": true,
      "flags": {
        "tormenta20": {}
      },
      "tint": "#ffffff",
      "_stats": {
        "coreVersion": "14.366",
        "systemId": "tormenta20",
        "systemVersion": "1.6.0",
        "createdTime": 1788042525113,
        "modifiedTime": 1788042525113,
        "lastModifiedBy": "4fJviA1Q4qcjwsna",
        "compendiumSource": null,
        "duplicateSource": null,
        "exportSource": null
      },
      "name": "Peste Esguia",
      "img": "systems/tormenta20/icons/racas/goblin.webp",
      "type": "base",
      "system": {
        "changes": [
          {
            "key": "system.attributes.movement.walk.base",
            "value": 9,
            "priority": null,
            "type": "override",
            "phase": "initial"
          },
          {
            "key": "system.tracos.tamanho",
            "value": "peq",
            "priority": null,
            "type": "override",
            "phase": "initial"
          }
        ],
        "targets": [],
        "status": null,
        "onuse": false,
        "abilityUse": {
          "description": "",
          "automatic": false,
          "aumenta": false,
          "custo": 0,
          "names": [],
          "types": []
        },
        "aura": {
          "isAura": false,
          "range": 0
        },
        "identifier": "",
        "upgrade": {
          "type": null,
          "itemType": []
        }
      },
      "description": "",
      "statuses": [],
      "sort": 0,
      "start": null,
      "showIcon": 1,
      "folder": null
    }
  ],
  "folder": "dlQytstdFJCCmHM7",
  "sort": 0,
  "flags": {},
  "system": {
    "description": {
      "value": "<p>placeholder</p>"
    },
    "source": "Tormenta20 — Edição Jogo do Ano, p. 23",
    "ativacao": {
      "execucao": "",
      "custo": 0,
      "qtd": "",
      "condicao": "",
      "special": ""
    },
    "duracao": {
      "value": 0,
      "units": "inst",
      "special": ""
    },
    "range": {
      "value": null,
      "units": ""
    },
    "efeito": "",
    "alcance": "none",
    "area": "",
    "resistencia": {
      "pericia": "",
      "atributo": "sab",
      "bonus": 0,
      "txt": ""
    },
    "rolls": [],
    "tipo": "racial",
    "subtipo": "Goblin",
    "chatFlavor": "",
    "origin": "",
    "tags": [],
    "chatGif": "",
    "rolltags": [],
    "automationtags": []
  },
  "ownership": {
    "default": 0
  },
  "_stats": {
    "systemId": "tormenta20",
    "systemVersion": "1.6.0",
    "coreVersion": "14.366",
    "createdTime": 1788042525113,
    "modifiedTime": 1788042525113,
    "lastModifiedBy": "4fJviA1Q4qcjwsna",
    "duplicateSource": null,
    "exportSource": null,
    "compendiumSource": null
  }
};


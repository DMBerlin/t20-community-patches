// Tormenta20 1.6.5 compendium data relevant to enchantment-data, taken from the "tormenta20.efeitos" effects and the
// Manto da Resistência ("tormenta20.equipamentos-magicos"). Descriptions are replaced by placeholders: the patch
// recognizes the real ones by FNV-1a hash and length, and tests swap the hashes with withPlaceholders().
export const UPGRADE_SOURCES = {
  "87bEYYpPzWdzX3zT": {
    "_id": "87bEYYpPzWdzX3zT",
    "name": "Guardião",
    "description": "<p>placeholder 87bEYYpPzWdzX3zT</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "guardian",
      "upgrade": {
        "type": "enchantment",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.attributes.defesa.bonus",
          "type": "add",
          "value": 2,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680533105,
      "modifiedTime": 1791692868953,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "S4FlovY4Qj03y6KB": {
    "_id": "S4FlovY4Qj03y6KB",
    "name": "Protetor",
    "description": "<p>placeholder S4FlovY4Qj03y6KB</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "protector",
      "upgrade": {
        "type": "enchantment",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.modificadores.pericias.resistencia",
          "type": "add",
          "value": 2,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680533111,
      "modifiedTime": 1791692868953,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "n39Gxf7O7DPC0R5V": {
    "_id": "n39Gxf7O7DPC0R5V",
    "name": "Relampejante",
    "description": "<p>placeholder n39Gxf7O7DPC0R5V</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "lightning",
      "upgrade": {
        "type": "enchantment",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.tracos.resistencias.eletricidade.bonus",
          "type": "add",
          "value": 10,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680533116,
      "modifiedTime": 1791692868954,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "nG4DzcxM7auuQKxw": {
    "_id": "nG4DzcxM7auuQKxw",
    "name": "Sombrio",
    "description": "<p>placeholder nG4DzcxM7auuQKxw</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "shadow",
      "upgrade": {
        "type": "enchantment",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.pericias.furt.bonus",
          "type": "add",
          "value": 5,
          "phase": "initial",
          "priority": null
        },
        {
          "key": "system.pericias.furt.bonus",
          "type": "add",
          "value": "@item.pda",
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680533116,
      "modifiedTime": 1791692868954,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "K9RtA8a5aPdqyRUR": {
    "_id": "K9RtA8a5aPdqyRUR",
    "name": "Mitral",
    "description": "<p>placeholder K9RtA8a5aPdqyRUR</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "mithril",
      "upgrade": {
        "type": "material",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.attributes.defesa.pda",
          "type": "add",
          "value": -2,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680622837,
      "modifiedTime": 1791693572891,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "UWWimfZsadIwa18F": {
    "_id": "UWWimfZsadIwa18F",
    "name": "Incandescente",
    "description": "<p>placeholder UWWimfZsadIwa18F</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "incandescent",
      "upgrade": {
        "type": "enchantment",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": []
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680533112,
      "modifiedTime": 1791692868953,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "RKOYBmM5NVeVkAC5": {
    "_id": "RKOYBmM5NVeVkAC5",
    "name": "Gelo Eterno",
    "description": "<p>placeholder RKOYBmM5NVeVkAC5</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": true,
      "abilityUse": {
        "automatic": true,
        "aumenta": false,
        "types": [
          "self"
        ]
      },
      "identifier": "everlasting-ice",
      "upgrade": {
        "type": "material",
        "itemType": [
          "weapon"
        ]
      },
      "changes": [
        {
          "key": "daon",
          "type": "add",
          "value": "2[frio]",
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680622838,
      "modifiedTime": 1791693572892,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "tdrbB9k7sDcQbhPr": {
    "_id": "tdrbB9k7sDcQbhPr",
    "name": "Gelo Eterno",
    "description": "<p>placeholder tdrbB9k7sDcQbhPr</p>",
    "transfer": true,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "everlasting-ice",
      "upgrade": {
        "type": "material",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.tracos.resistencias.frio.bonus",
          "type": "add",
          "value": 5,
          "phase": "initial",
          "priority": null
        },
        {
          "key": "system.tracos.resistencias.frio.bonus",
          "type": "add",
          "value": 10,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680622841,
      "modifiedTime": 1791693572892,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "LdQuKLoY9UexlLFJ": {
    "_id": "LdQuKLoY9UexlLFJ",
    "name": "Adamante",
    "description": "<p>placeholder LdQuKLoY9UexlLFJ</p>",
    "transfer": true,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "adamant",
      "upgrade": {
        "type": "material",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.tracos.resistencias.dano.bonus",
          "type": "add",
          "value": 2,
          "phase": "initial",
          "priority": null
        },
        {
          "key": "system.tracos.resistencias.dano.bonus",
          "type": "add",
          "value": 5,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680622837,
      "modifiedTime": 1791693572891,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "9qtyaxELLc4xqkMk": {
    "_id": "9qtyaxELLc4xqkMk",
    "name": "Invulnerável (Armadura)",
    "description": "<p>placeholder 9qtyaxELLc4xqkMk</p>",
    "transfer": true,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "invulnerable",
      "upgrade": {
        "type": "enchantment",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.attributes.defesa.bonus",
          "type": "add",
          "value": 5,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680533105,
      "modifiedTime": 1791693572891,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "hlCxCLAj9zaurVbw": {
    "_id": "hlCxCLAj9zaurVbw",
    "name": "Invulnerável (Escudo)",
    "description": "<p>placeholder hlCxCLAj9zaurVbw</p>",
    "transfer": true,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "invulnerable",
      "upgrade": {
        "type": "enchantment",
        "itemType": [
          "armor",
          "shield"
        ]
      },
      "changes": [
        {
          "key": "system.attributes.defesa.bonus",
          "type": "add",
          "value": 2,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680533115,
      "modifiedTime": 1791693572892,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "0oBNqjSt3Ax3aO3a": {
    "_id": "0oBNqjSt3Ax3aO3a",
    "name": "Delicada",
    "description": "<p>placeholder 0oBNqjSt3Ax3aO3a</p>",
    "transfer": true,
    "disabled": false,
    "system": {
      "onuse": false,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": []
      },
      "identifier": "delicate",
      "upgrade": {
        "type": "improvement",
        "itemType": [
          "armor"
        ]
      },
      "changes": [
        {
          "key": "system.attributes.defesa.bonus",
          "type": "add",
          "value": 1,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680634923,
      "modifiedTime": 1791680634923,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "SXtfjuLdQwXZUU1t": {
    "_id": "SXtfjuLdQwXZUU1t",
    "name": "Discreto",
    "description": "<p>placeholder SXtfjuLdQwXZUU1t</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": true,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": [
          "skill"
        ]
      },
      "identifier": "discreet",
      "upgrade": {
        "type": "improvement",
        "itemType": [
          "weapon",
          "armor",
          "shield",
          "esoteric",
          "tool",
          "clothing",
          "accessory"
        ]
      },
      "changes": [
        {
          "key": "roll",
          "type": "add",
          "value": 5,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680634928,
      "modifiedTime": 1791680634928,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "7apVrQDXAOmTvcQW": {
    "_id": "7apVrQDXAOmTvcQW",
    "name": "Mitral",
    "description": "<p>placeholder 7apVrQDXAOmTvcQW</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": true,
      "abilityUse": {
        "automatic": true,
        "aumenta": false,
        "types": [
          "self"
        ]
      },
      "identifier": "mithril",
      "upgrade": {
        "type": "material",
        "itemType": [
          "weapon"
        ]
      },
      "changes": [
        {
          "key": "criticoM",
          "type": "add",
          "value": -1,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680622836,
      "modifiedTime": 1791693572891,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  },
  "QL2A7Lhlh9tVDqcB": {
    "_id": "QL2A7Lhlh9tVDqcB",
    "name": "Mitral",
    "description": "<p>placeholder QL2A7Lhlh9tVDqcB</p>",
    "transfer": false,
    "disabled": false,
    "system": {
      "onuse": true,
      "abilityUse": {
        "automatic": false,
        "aumenta": false,
        "types": [
          "spell"
        ]
      },
      "identifier": "mithril",
      "upgrade": {
        "type": "material",
        "itemType": [
          "esoteric"
        ]
      },
      "changes": [
        {
          "key": "cd",
          "type": "add",
          "value": 2,
          "phase": "initial",
          "priority": null
        }
      ]
    },
    "_stats": {
      "compendiumSource": null,
      "duplicateSource": null,
      "createdTime": 1791680622838,
      "modifiedTime": 1791693572892,
      "lastModifiedBy": "fMILAiVcmBGZmE6r"
    }
  }
};

export const CLOAK_SOURCE = {
  "name": "Manto da Resistência",
  "system": {
    "description": {
      "value": "<p>placeholder zPxlM4MNoKihGsDn</p>"
    }
  },
  "_stats": {
    "compendiumSource": null,
    "duplicateSource": null,
    "createdTime": 1788042454304,
    "modifiedTime": 1788042454304,
    "lastModifiedBy": "4fJviA1Q4qcjwsna"
  },
  "effects": [
    {
      "_id": "p3l6lvXx7HMjVtS0",
      "name": "Manto da Resistência",
      "description": "",
      "transfer": true,
      "disabled": true,
      "system": {
        "onuse": false,
        "abilityUse": {
          "automatic": false,
          "aumenta": false,
          "types": []
        },
        "identifier": "",
        "upgrade": {
          "type": null,
          "itemType": []
        },
        "changes": [
          {
            "key": "system.modificadores.pericias.resistencia",
            "value": 2,
            "priority": null,
            "type": "add",
            "phase": "initial"
          }
        ]
      },
      "_stats": {
        "compendiumSource": null,
        "duplicateSource": null,
        "createdTime": 1788042454305,
        "modifiedTime": 1788042454305,
        "lastModifiedBy": "4fJviA1Q4qcjwsna"
      }
    }
  ]
};

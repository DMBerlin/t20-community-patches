// Tormenta20 1.6.5 methods extended by the non-proficiency rule, verbatim from tormenta20.mjs (T20:8148-8232, 19835-19872).
/* eslint-disable */
export class Item165 {
	getAttackToHit() {
		const itemData = this.system;
		const rollData = this.getRollData();
		const roll = itemData.rolls.find((r) => r.type === "ataque");
		if (!this.hasAttack || !itemData || roll.parts.length < 2) return;
		// Define Roll bonuses
		const parts = roll.parts.map((p) => p[0] ?? p); // ;

		// Take no further action for un-owned items
		if (!this.isOwned) return { rollData, parts };
		const actorData = this.actor.system;
		const flags = this.actor.flags.tormenta20 || {};

		// Add skill bonus
		if (roll.parts[1][0]) {
			parts[1] = "@skill";
			if (!foundry.utils.isEmpty(actorData.pericias)) {
				rollData.skill = actorData.pericias[roll.parts[1][0]].value || 0;
			}
			// Change Skill Ability modifier
			let atributo = roll.parts[1][1];
			if (!atributo) {
				const { empunhadura, proposito } = this.system;
				const { for: forca, des } = actorData.atributos;
				const usarAcuidade =
					(game.settings.get("tormenta20", "lightFinesseWeapons") || flags?.acuidade) && des.value > forca.value;
				switch (proposito) {
					case "arremesso":
						if (flags?.arremessoPotente) atributo = "for";
						break;
					case "disparo":
						break;
					case "corpo-a-corpo":
					case "corpo-a-corpo-arremesso":
					default: {
						if (usarAcuidade && empunhadura === "leve") atributo = "des";
					}
				}
			}
			if (atributo) {
				const skill = actorData.pericias[roll.parts[1][0]];
				const abls = actorData.atributos;
				rollData.skill = skill.value - abls[skill.atributo].value + abls[atributo].value;
			}
		}

		// Item modifications and enchantments TODO
		// const mods = itemData.modificacoes;
		// if( mods?.pungente ) parts.push(2);
		// else if( mods?.certeira ) parts.push(1);
		// const enchants = itemData.encantos;
		// if( enchants?.magnifica || enchants.energetica ) parts.push(4);
		// else if( enchants?.formidavel ) parts.push(2);

		// Actor-level global bonus to attack rolls
		const bonuses = this.actor.system.modificadores?.ataque || {};
		if (bonuses.geral) parts.push(...bonuses.geral);
		if (bonuses.cac && roll.parts[1][0] !== "pont") {
			parts.push(...bonuses.cac);
		}
		if (bonuses.ad && roll.parts[1][0] === "pont") {
			parts.push(...bonuses.ad);
		}

		// One-time bonus provided by consumed ammunition
		if (itemData.consume?.type === "ammo" && this.actor.items) {
			const ammoItemData = this.actor.items.get(itemData.consume.target)?.system;

			if (ammoItemData) {
				const ammoItemQuantity = ammoItemData.qtd;
				const ammoCanBeConsumed = ammoItemQuantity && ammoItemQuantity - (itemData.consume.amount ?? 0) >= 0;
				const ammoAtqBns = ammoItemData.atqBns;
				const ammoIsTypeConsumable = ammoItemData.type === "consumivel" && ammoItemData.subtipo === "ammo";
				if (ammoCanBeConsumed && ammoAtqBns && ammoIsTypeConsumable) {
					parts.push("@ammo");
					rollData.ammo = ammoAtqBns;
				}
			}
		}

		// Condense the resulting attack bonus formula into a simplified label
		parts.shift();
		// Update labels and return the prepared roll data
		return { rollData, parts };
	}
}

export class CreatureData165 {
	prepareSkill(skillId, { skillData, rollData, atributo } = {}) {
		if (skillId === "ofic") return;

		const parts = ["@meionivel"];

		skillData ??= foundry.utils.deepClone(this.pericias[skillId]);
		rollData ??= this.parent.getRollData();
		atributo ??= skillData.atributo;
		skillData.atributo = atributo;

		skillData.label ||= CONFIG.T20.pericias[skillId]?.label || skillId;

		parts.push(`@${skillData.atributo}`);
		if (skillData.treinado) parts.push("@treino");
		if (skillData.bonus.length) parts.push(...skillData.bonus);
		if (skillData.pda && rollData.pda) parts.push("@pda");
		if (skillData.size && rollData.tamanho) parts.push("@tamanho");
		if (skillData.outros) parts.push(skillData.outros);
		if (skillData.condi) parts.push(skillData.condi);

		// GET GLOBAL ACTOR MODIFIERS
		const bonuses = foundry.utils.getProperty(this, "modificadores.pericias") || {};
		if (bonuses.geral?.filter(Boolean).length) parts.push("@pericia");
		if (Object.keys(CONFIG.T20.resistencias).includes(skillId) && bonuses.resistencia?.filter(Boolean).length) {
			parts.push("@resistencia");
		}
		else if (!["luta", "pont"].includes(skillId) && bonuses.semataque?.filter(Boolean).length) parts.push("@semataque");
		else if (["luta", "pont"].includes(skillId) && bonuses.ataque?.filter(Boolean).length) parts.push("@ataque");
		if (bonuses.atr && bonuses.atr[skillData.atributo]?.filter(Boolean).length) {
			parts.push(...bonuses.atr[skillData.atributo]);
		}

		const result = simplifyRollFormula(parts.join("+"), rollData, {
			}).trim();
		skillData.value = parseInt(result) || 0;

		return skillData;
	}
}

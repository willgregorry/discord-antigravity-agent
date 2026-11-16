const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { executeAiPrompt } = require('./ai-runner.helper');

/**
 * Handles interactive strategic decision buttons & custom-answer modals
 * emitted by `[ASK_USER: ...]` checkpoints.
 */
module.exports = function createInteractiveCommands(ctx) {
  return {
    buttons: [
      {
        match: id => id.startsWith('ask_opt_'),
        handle: async (interaction, session) => {
          // Format: ask_opt_<qId>_<index> where qId may contain underscores (`q_<ts>_<rand>`)
          const body = interaction.customId.slice('ask_opt_'.length);
          const lastSep = body.lastIndexOf('_');
          const qId = body.slice(0, lastSep);
          const optIdx = parseInt(body.slice(lastSep + 1), 10);

          const pending = ctx.pendingQuestions.get(qId);
          if (!pending) {
            await interaction.reply({
              content: '⚠️ Pertanyaan ini sudah terjawab atau kadaluarsa. Silakan balas langsung lewat chat.',
              ephemeral: true
            });
            return;
          }

          const chosen = pending.options[optIdx];
          if (!chosen) {
            await interaction.reply({ content: '❌ Opsi tidak valid.', ephemeral: true });
            return;
          }

          ctx.pendingQuestions.delete(qId);
          await interaction.update({
            content: `✅ **Keputusan Dipilih:** \`${chosen}\``,
            components: []
          });

          const followUpPrompt = `Untuk pertanyaan: "${pending.question}"\nUser memilih opsi: "${chosen}".\nLanjutkan sesuai pilihan tersebut.`;
          await executeAiPrompt({ channel: interaction.channel, session, promptText: followUpPrompt, ctx, mode: 'chat' });
        }
      },
      {
        match: id => id.startsWith('ask_custom_'),
        handle: async (interaction) => {
          const qId = interaction.customId.slice('ask_custom_'.length);
          const pending = ctx.pendingQuestions.get(qId);
          if (!pending) {
            await interaction.reply({
              content: '⚠️ Pertanyaan ini sudah terjawab atau kadaluarsa. Silakan balas langsung lewat chat.',
              ephemeral: true
            });
            return;
          }

          const modal = new ModalBuilder()
            .setCustomId(`modal_ask_custom_${qId}`)
            .setTitle('Kirim Arahan Custom');

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('custom_answer')
                .setLabel(pending.question.slice(0, 45))
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Ketik pilihan atau arahanmu sendiri di sini...')
                .setRequired(true)
            )
          );

          await interaction.showModal(modal);
        }
      }
    ],

    modals: [
      {
        match: id => id.startsWith('modal_ask_custom_'),
        handle: async (interaction, session) => {
          const qId = interaction.customId.slice('modal_ask_custom_'.length);
          const pending = ctx.pendingQuestions.get(qId);
          const answer = interaction.fields.getTextInputValue('custom_answer').trim();

          ctx.pendingQuestions.delete(qId);

          const ackContent = `✅ **Arahan Custom Dikirim:**\n> ${answer}`;
          try {
            await interaction.update({ content: ackContent, components: [] });
          } catch (_) {
            await interaction.reply({ content: ackContent });
          }

          const questionLine = pending ? `Untuk pertanyaan: "${pending.question}"\n` : '';
          const followUpPrompt = `${questionLine}User memberikan jawaban/arahan custom:\n"${answer}"\nLanjutkan sesuai arahan tersebut.`;
          await executeAiPrompt({ channel: interaction.channel, session, promptText: followUpPrompt, ctx, mode: 'chat' });
        }
      }
    ]
  };
};

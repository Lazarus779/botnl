const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const axios = require('axios');
const base64 = require('base-64');
const coinbase = require('coinbase-commerce-node');
const Client = coinbase.Client;
const Charge = coinbase.resources.Charge;
let waitingForUsername = {};
const waitingForLines = {};
const client = Client.init('c3ccfe07-88b5-497b-948c-b2ca4eb1f80b');
client.setRequestTimeout(3000);
const bot = new Telegraf('6254956099:AAGSYzqaQrbuX0vV6vUZuLgKlwX6MkA9n74');

// Commande pour ajouter du solde (réservée aux administrateurs)
bot.command('ajouter_solde', (ctx) => {
  const userId = ctx.from.id; // Obtenez l'ID de l'utilisateur qui a envoyé la commande
  const user = users[userId]; // Obtenez les données de l'utilisateur actuel

  // Vérifiez si l'utilisateur est un administrateur (vous pouvez personnaliser cette vérification)
  if (user && user.role === 'Administrateur') {
    // Vérifiez si l'utilisateur a fourni un ID d'utilisateur et un montant
    const args = ctx.message.text.split(' ');
    if (args.length !== 3) {
      return ctx.reply('Utilisation : /ajouter_solde <ID de l\'utilisateur> <montant>');
    }

    const targetUserId = parseInt(args[1]);
    const amount = parseFloat(args[2]);

    if (!isNaN(targetUserId) && !isNaN(amount)) {
      // Vérifiez si l'utilisateur cible existe
      if (users[targetUserId]) {
        // Ajoutez le montant spécifié à la balance de l'utilisateur cible
        users[targetUserId].balance += amount;
        fs.writeFileSync('user.json', JSON.stringify(users, null, 2));

        // Envoyez un message à l'utilisateur cible
        bot.telegram.sendMessage(targetUserId, `Votre solde vient d'être mis à jour ✅ Solde actuel : ${users[targetUserId].balance} €`);
        
        ctx.reply(`Solde de l'utilisateur avec l'ID ${targetUserId} mis à jour. Nouveau solde : ${users[targetUserId].balance} €`);
      } else {
        ctx.reply('Utilisateur cible non trouvé.');
      }
    } else {
      ctx.reply('Veuillez fournir un ID d\'utilisateur valide et un montant valide.');
    }
  } else {
    ctx.reply('Vous n\'avez pas l\'autorisation d\'ajouter du solde.');
  }
});





let chatId; 
bot.action('recharge', async (ctx) => {
  const userId = ctx.from.id; // Obtenez l'ID de l'utilisateur
  let chargeId = null; // Variable pour stocker l'ID de la charge

  // Demandez le montant que l'utilisateur souhaite recharger
  await ctx.reply('Entrez le montant que vous souhaitez recharger (en euros) :');

  bot.hears(/^\d+(.\d{1,2})?$/, async (ctx) => {
    const amount = ctx.match[0];
    try {
      // Créez les adresses de paiement
      const addresses = await createPaymentAddresses(amount, userId);

      const responseMessage = `
      🌐 Complétez le paiement en envoyant ${amount} € à l'une des adresses ci-dessous ou en utilisant le lien :
      💸 - Ethereum : ${addresses.ethereum}
      💸 - Tether : ${addresses.tether}
      💸 - Litecoin : ${addresses.litecoin}
      💸 - Bitcoin : ${addresses.bitcoin}
      🔗 Lien : ${addresses.paymentLink}
      `;
      ctx.reply(responseMessage);

      chargeId = addresses.paymentLink.split('/').pop();

      // Vérifiez le statut du paiement toutes les 30 secondes
      const intervalId = setInterval(async () => {
        console.log(`Vérification du statut de la charge (${chargeId})...`);
        if (chargeId) {
          const retrievedCharge = await Charge.retrieve(chargeId);
          const paymentStatus = retrievedCharge.payments[0]?.status;
          console.log(`Statut actuel du paiement : ${paymentStatus}`);
          if (paymentStatus === 'completed') {
            clearInterval(intervalId);

            const metadata = retrievedCharge.metadata;
            const user = users[metadata.userId];
            
            if (user) {
              user.balance += metadata.amount;
              // Mise à jour du solde de l'utilisateur dans votre système
              // Assurez-vous d'adapter cela à votre propre logique de gestion des utilisateurs
            }

            bot.telegram.sendMessage(metadata.userId, `Paiement Validé ✅ Votre solde a été mis à jour. Votre solde actuel : ${user.balance} €`);

            ctx.reply('Merci pour l\'achat !');
          }
        } else {
          clearInterval(intervalId);
          ctx.reply('Rechargement annulé.');
          
          try {
            await Charge.cancel(chargeId);
          } catch (error) {
            console.error('Error cancelling charge:', error);
          }
        }
      }, 30000); // Vérifiez toutes les 30 secondes
    } catch (error) {
      console.error('Error creating charge:', error);
      ctx.reply('Une erreur s\'est produite lors de la génération des adresses de paiement.');
    }
  });
});

async function createPaymentAddresses(amount, userId) {
  const chargeData = {
    name: 'Recharge de solde',
    description: 'Rechargez votre solde en utilisant les adresses ci-dessous',
    local_price: {
      amount: amount.toString(),
      currency: 'EUR'
    },
    pricing_type: 'fixed_price'
  };

  try {
    const charge = await Charge.create(chargeData);

    // Stockez le montant et l'ID de l'utilisateur pour la validation du paiement
    charge.metadata = {
      userId: userId,
      amount: amount
    };
    return {
      ethereum: charge.addresses.ethereum,
      tether: charge.addresses.tether,
      litecoin: charge.addresses.litecoin,
      bitcoin: charge.addresses.bitcoin,
      paymentLink: charge.hosted_url
    };
  } catch (error) {
    console.error('Error creating charge:', error);
    throw error;
  }
}

async function cancelPayment(ctx) {
  ctx.deleteMessage();
  const userId = ctx.from.id;
  let chargeIdToCancel = null;
  try {
    // Lisez le contenu du fichier charge.json
    const chargeData = fs.readFileSync('charge.json', 'utf8');
    const charge = JSON.parse(chargeData);

    // Vérifiez si la charge correspond à l'ID de l'utilisateur
    if (charge.metadata && charge.metadata.userId === userId) {
      chargeIdToCancel = charge.id;
    }

    if (chargeIdToCancel) {
      const config = {
        method: 'post',
        url: `https://api.commerce.coinbase.com/charges/${chargeIdToCancel}/cancel`,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Version': '2018-03-22' // Assurez-vous d'utiliser la version correcte de l'API
        }
      };

      axios(config)
        .then((response) => {
          console.log(JSON.stringify(response.data));
          // Mettez à jour le statut de la charge dans le fichier charge.json
          charge.status = 'cancelled';
          fs.writeFileSync('charge.json', JSON.stringify(charge, null, 2));

          ctx.reply('Rechargement annulé.');
        })
        .catch((error) => {
          console.log(error);
          ctx.reply('Rechargement annulé.' ,retour1);
        });
    } else {
      ctx.reply("Aucun rechargement en cours à annuler pour cet utilisateur.");
    }
  } catch (error) {
    console.error('Error cancelling charge:', error);
    ctx.reply('Erreur lors de l\'annulation du rechargement.');
  }
}

// Utilisation de la fonction pour annuler le paiement
bot.command('cancel', (ctx) => {
  cancelPayment(ctx); // Passez le contexte (ctx) en tant que paramètre
});

// Menu principal
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('Numliste FR 🇫🇷', 'numliste')],
    [Markup.button.callback('🥷 Compte', 'compte')],
    [Markup.button.url('🛠️ Support', 'https://t.me/niceislandsupport')],
    [Markup.button.callback('💰 Recharger mon compte', 'recharge')],
  ]);


 



// Chargement des utilisateurs à partir du fichier user.json
let users = {};
if (fs.existsSync('user.json')) {
  users = JSON.parse(fs.readFileSync('user.json'));
}

// Ajouter une commande pour l'action "compte"
bot.action('compte', (ctx) => {
  const userId = ctx.from.id; // Obtenez l'ID de l'utilisateur actuel

  // Vérifiez si l'utilisateur existe dans le fichier JSON
  if (users[userId]) {
    const user = users[userId];
    const message = `
💡 En cas de problème avec le bot veuillez contacter @Laz4russ.
🧑‍🎓 Rank: ${user.role}
🆔 Votre ID: ${userId}
👤 Nom d'utilisateur: ${user.name}
💰 Balance : ${user.balance}€
    `;

    // Utilisez un try...catch pour éviter l'erreur
    try {
      ctx.editMessageText(message, retour1);
    } catch (error) {
      console.error(error);
    }
  } else {
    // L'utilisateur n'existe pas dans le fichier JSON
    ctx.editMessageText('Utilisateur non trouvé. Veuillez contacter le support.', retour1);
  }
});








     // Créer un clavier pour les plans Plesk
     const retour1 = Markup.inlineKeyboard([

      [Markup.button.callback('Retour', 'retour')],
    ]);






// Fonction pour compter les lignes dans un fichier
function countLinesInFile(filename) {
  try {
    const data = fs.readFileSync(filename, 'utf8');
    const lines = data.split('\n');
    return lines.length;
  } catch (err) {
    console.error(`Error reading ${filename}: ${err}`);
    return 0;
  }
}

// Obtenir le nombre de lignes initiales pour chaque fichier
let bouyguesLines = countLinesInFile('bouygues.txt');
let orangeLines = countLinesInFile('orange.txt');
let freeLines = countLinesInFile('free.txt');
let mixtLines = countLinesInFile('mixte.txt');
let sfrLines = countLinesInFile('sfr.txt');

// Fonction pour mettre à jour le nombre de lignes toutes les 2 secondes
function updateLineCounts() {
  bouyguesLines = countLinesInFile('bouygues.txt');
  orangeLines = countLinesInFile('orange.txt');
  freeLines = countLinesInFile('free.txt');
  mixtLines = countLinesInFile('mixte.txt');
  sfrLines = countLinesInFile('sfr.txt');
}

// Planifiez la mise à jour du nombre de lignes toutes les 2 secondes
setInterval(updateLineCounts, 2000);

// ... (autre code)

// Fonction de gestionnaire de callback pour le bouton "plesk"
bot.action('numliste', (ctx) => {
  ctx.answerCbQuery('Voici les pays disponibles :');

  // Créer un clavier pour les plans Plesk
  const pleskMenu = Markup.inlineKeyboard([
    [Markup.button.callback(`🇫🇷 Bouygues(${bouyguesLines})`, 'bouygues')],
    [Markup.button.callback(`🇫🇷 Orange(${orangeLines})`, 'orange')],
    [Markup.button.callback(`🇫🇷 Sfr(${sfrLines})`, 'sfr')],
    [Markup.button.callback(`🇫🇷 Free(${freeLines})`, 'free')],
    [Markup.button.callback(`🇫🇷 Mixte(${mixtLines})`, 'mixte')],
    [Markup.button.callback('Retour', 'retour')],
  ]);

  // Envoyer le clavier de plan Plesk à l'utilisateur
  ctx.editMessageText('Choisissez un opérateur :', pleskMenu);
});


// Ajoutez cette fonction pour extraire les lignes du fichier, les envoyer à l'utilisateur et les supprimer du fichier d'origine
async function extractAndSendLines(ctx, filename) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const userUsername = ctx.from.username;

  // Demandez à l'utilisateur combien de lignes il souhaite extraire
  await ctx.reply('Combien de lignes souhaitez-vous extraire ? Répondez avec un nombre.');

  // Attendez la réponse de l'utilisateur
  waitingForLines[userId] = filename; // Stockez le nom du fichier en cours de traitement
  bot.hears(/^\d+$/, async (ctx) => {
    const numLines = parseInt(ctx.match[0]);

    // Vérifiez si le nombre de lignes est un nombre rond et au moins 1000
    if (numLines % 1000 === 0 && numLines >= 1000) {
      const filePath = `${waitingForLines[userId]}.txt`;

      // Vérifiez si le nombre de lignes demandé est supérieur au nombre de lignes dans le fichier
      const fileLines = countLinesInFile(filePath);
      if (numLines <= fileLines) {
        // Lire le fichier d'origine
        try {
          const data = fs.readFileSync(filePath, 'utf8');
          const lines = data.split('\n').slice(0, numLines).join('\n'); // Extraire les premières lignes

          // Déduisez 2 de la balance de l'utilisateur pour chaque tranche de 1000 lignes
          const linesExtracted = numLines;
          const userBalance = users[userId].balance || 0;
          const deduction = Math.floor(linesExtracted / 1000) * 2;
          if (deduction > 0 && userBalance >= deduction) {
            users[userId].balance -= deduction;
            fs.writeFileSync('user.json', JSON.stringify(users, null, 2));

            // Enregistrez les lignes extraites dans un nouveau fichier bouyguesUHQ.txt
            const newFilePath = `${waitingForLines[userId]}UHQ.txt`;
            fs.writeFileSync(newFilePath, lines);

            // Envoyez le fichier au chat
            await ctx.replyWithDocument({ source: newFilePath });

            // Supprimez les lignes extraites du fichier d'origine
            const remainingLines = data.split('\n').slice(numLines).join('\n');
            fs.writeFileSync(filePath, remainingLines);

            // Supprimez le fichier temporaire
            fs.unlinkSync(newFilePath);

            // Supprimez la clé en attente pour cet utilisateur
            delete waitingForLines[userId];

            await ctx.reply(`Merci pour votre achat 🥷✅ | Voici votre solde actuel : ${users[userId].balance || 0} €`, Markup.inlineKeyboard([
              Markup.button.callback('Retour', 'retour')
            ]));
          } else {
            await ctx.reply('Solde insuffisant, veuillez recharger votre compte.');
          }
        } catch (err) {
          console.error(`Error extracting lines: ${err}`);
          await ctx.reply('Une erreur s\'est produite lors de l\'extraction des lignes.');
        }
      } else {
        await ctx.reply('Leads Épuisés ❌, un restock se fera bientôt 🥷');
      }
    } else {
      // Le nombre de lignes n'est pas valide, demandez à l'utilisateur de saisir un nombre valide
      await ctx.reply('Veuillez entrer un nombre rond supérieur ou égal à 1000 (par exemple, 1000, 2000, 3000).');
    }
  });
}


// Ajoutez cette gestion d'action pour chaque opérateur
bot.action('bouygues', (ctx) => {
  extractAndSendLines(ctx, 'bouygues');
});

bot.action('orange', (ctx) => {
  extractAndSendLines(ctx, 'orange');
});

bot.action('free', (ctx) => {
  extractAndSendLines(ctx, 'free');
});

bot.action('mixte', (ctx) => {
  extractAndSendLines(ctx, 'mixte');
});

bot.action('sfr', (ctx) => {
  extractAndSendLines(ctx, 'sfr');
});

// Vous pouvez également ajouter un bouton "Retour" pour revenir au menu précédent


// Fonction de gestionnaire de callback pour le bouton "Annuler" dans le résumé de la commande
bot.action('retour', (ctx) => {
  ctx.answerCbQuery('Retour au menu principal.');

  // Envoyer le menu principal à l'utilisateur
  ctx.editMessageText('🥷 Lazarus Leads 🥷\n\n🥷🚀 Service automatique de vente de NumList Dump + filtrer (anti duplicate) + check amazon + check portabilité !\n\nLa Numliste la plus uhq du marcher 💎 🥷 🚀\n\n Groupe ➡️ @lazarussgroup  Canal ➡️ @lazarussinfo', mainMenu);
});


// Fonction de gestionnaire de callback pour le bouton "Retour"
bot.action('retour', (ctx) => {
  ctx.answerCbQuery('Retour au menu principal.');

  // Envoyer le menu principal à l'utilisateur
  ctx.editMessageText('🥷 Lazarus Leads 🥷\n\n🥷🚀 Service automatique de vente de NumList Dump + filtrer (anti duplicate) + check amazon + check portabilité !\n\nLa Numliste la plus uhq du marcher 💎 🥷 🚀\n\n Groupe ➡️ @lazarussgroup  Canal ➡️ @lazarussinfo', mainMenu);
});


bot.start((ctx) => {
  const userId = ctx.from.id; // obtenir l'ID de l'utilisateur
  const username = ctx.from.username; // obtenir le nom d'utilisateur de l'utilisateur
  let role = 'User'; // définir un rôle par défaut pour les nouveaux utilisateurs
  let balance = 0; // définir un solde par défaut pour les nouveaux utilisateurs

  // Vérifier si l'utilisateur existe déjà dans le fichier JSON
  if (users[userId]) {
    role = users[userId].role;
    balance = users[userId].balance;
  } else {
    // Ajouter l'utilisateur au fichier JSON s'il n'existe pas déjà
    users[userId] = {
      name: username,
      role: role,
      balance: 0
    };
    fs.writeFileSync('user.json', JSON.stringify(users, null, 2));
  }
  ctx.reply('🥷 Lazarus Leads 🥷\n\n🥷🚀 Service automatique de vente de NumList Dump + filtrer (anti duplicate) + check amazon + check portabilité !\n\nLa Numliste la plus uhq du marcher 💎 🥷 🚀\n\n Groupe ➡️ @lazarussgroup  Canal ➡️ @lazarussinfo', mainMenu);
});






bot.launch();
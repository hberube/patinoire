// FAQ content (FR/EN). Answers are trusted static HTML; values coming from config are
// passed through esc() by the caller. {{key}} placeholders are filled from `vars`.

const FAQ = {
  fr: [
    {
      section: "Votre image",
      items: [
        {
          q: "Comment changer ma photo ou le logo de mon équipe?",
          a: `<ol>
            <li>Touchez <b>Connexion</b> en haut, choisissez votre nom et entrez votre NIP.</li>
            <li>Allez dans l'onglet <b>Équipes</b>. Votre carte <b>Mon équipe</b> est en haut.</li>
            <li>Touchez <b>Changer mon image</b>, puis choisissez <b>Logo d'équipe</b> ou <b>Ma photo</b>.</li>
            <li>Touchez <b>Choisir une image…</b> et prenez une image de votre téléphone ou de votre ordinateur. Un aperçu montre le résultat.</li>
            <li>Touchez <b>Envoyer à Hugo</b>.
              <ul>
                <li><b>Sur un téléphone :</b> le menu de partage s'ouvre. Choisissez Messages ou Courriel et envoyez à Hugo.</li>
                <li><b>Sur un ordinateur :</b> l'image est enregistrée dans vos téléchargements et un courriel s'ouvre. Joignez l'image et envoyez.</li>
              </ul></li>
          </ol>
          <p>Hugo publie l'image; elle apparaît sur le site quelques minutes plus tard.</p>
          {{teamsButton}}`,
        },
        {
          q: "Quel genre d'image fonctionne le mieux?",
          a: `<ul>
            <li><b>Photo :</b> un portrait où l'on voit bien votre visage. Elle est recadrée en carré au centre et affichée dans un cercle.</li>
            <li><b>Logo :</b> une image carrée, idéalement un PNG avec fond transparent. Le logo est gardé en entier.</li>
            <li>JPG, PNG, WebP ou GIF. Pas besoin de réduire la taille : le site s'en occupe.</li>
          </ul>`,
        },
        {
          q: "Où apparaissent ma photo et mon logo?",
          a: `<p>Votre <b>logo</b> apparaît dans le classement, sur votre carte d'équipe et dans la Gazette. Votre <b>photo</b> apparaît en grand sur le podium, dans la fiche de votre équipe et dans « Ce soir ». Sans image, vos initiales sont affichées.</p>`,
        },
      ],
    },
    {
      section: "Les échanges",
      items: [
        {
          q: "Quelles sont les règles des échanges?",
          a: `<ul>
            <li>Chaque équipe a droit à <b>{{f}} échange d'attaquant</b>, <b>{{d}} de défenseur</b> et <b>{{g}} de gardien</b> pour la saison.</li>
            <li>Un joueur ne peut être échangé que contre un autre joueur <b>de la même ronde</b> du formulaire.</li>
            <li>Les échanges sont permis à partir du <b>{{opens}}</b>.</li>
            <li>Les points que votre ancien joueur a déjà accumulés <b>restent dans votre total</b>. Le nouveau joueur compte seulement à partir de l'approbation.</li>
          </ul>`,
        },
        {
          q: "Comment proposer un échange?",
          a: `<ol>
            <li>Touchez <b>Connexion</b> et entrez votre NIP.</li>
            <li>Allez dans l'onglet <b>Échanges</b>.</li>
            <li><b>1. Joueur qui sort :</b> touchez le joueur que vous voulez échanger. Le « R » indique sa ronde.</li>
            <li><b>2. Joueur qui entre :</b> les autres joueurs de la même ronde s'affichent, avec leurs points cette saison. Touchez votre choix.</li>
            <li>Touchez <b>Générer le code d'échange</b>.</li>
            <li>Envoyez le message à Hugo avec <b>Copier</b>, <b>Partager</b> ou <b>Courriel</b>. Envoyez-le de <b>votre</b> téléphone ou de <b>votre</b> courriel : Hugo vérifie qui l'envoie.</li>
          </ol>
          {{tradesButton}}`,
        },
        {
          q: "Quand mon échange compte-t-il?",
          a: `<p>Dès que Hugo l'approuve. Le classement est mis à jour 2 à 3 minutes après, et l'échange apparaît dans <b>Échanges approuvés</b>. Votre ancien joueur reste visible dans la fiche de votre équipe avec ses points conservés.</p>`,
        },
        {
          q: "Je me suis trompé ou j'ai changé d'idée.",
          a: `<p>Tant que Hugo n'a pas approuvé, rien n'est fait : écrivez-lui simplement pour annuler, puis envoyez un nouveau code si vous voulez. Une fois approuvé, l'échange est final.</p>`,
        },
        {
          q: "Pourquoi le bouton « Générer le code » est-il gris?",
          a: `<p>Soit la période d'échanges n'est pas encore ouverte (à partir du {{opens}}), soit vous avez déjà utilisé votre échange à cette position, soit il manque un choix à l'étape 1 ou 2.</p>`,
        },
      ],
    },
    {
      section: "Le pool",
      items: [
        {
          q: "Comment me connecter? J'ai oublié mon NIP.",
          a: `<p>Touchez <b>Connexion</b>, choisissez votre nom et entrez le NIP que Hugo vous a remis. Si vous l'avez oublié, demandez-en un nouveau à Hugo. La connexion sert seulement à voir « Mon équipe » et à proposer des échanges; le classement est visible sans connexion.</p>`,
        },
        {
          q: "Comment les points sont-ils calculés?",
          a: `<ul>{{scoring}}</ul><p>Un joueur rapporte des points seulement pendant qu'il est dans votre équipe.</p><p><b>Égalité de points?</b> Le plus de lignes de bingo cette saison (colonne 🎱 du classement) passe devant, puis le plus de buts; si tout est égal, les équipes partagent le rang.</p>`,
        },
        {
          q: "Quand le classement est-il mis à jour?",
          a: `<ul>
            <li><b>Chaque matin vers 5 h :</b> classement, trajectoire et Gazette, avec les matchs de la veille.</li>
            <li><b>Pendant les matchs</b> (aux 15 minutes) : l'onglet « Ce soir ».</li>
            <li><b>Quelques minutes après</b> un échange ou une nouvelle image approuvés par Hugo.</li>
          </ul>`,
        },
        {
          q: "C'est quoi, la Gazette et les duels?",
          a: `<p>La <b>Gazette</b> résume la veille : les buts des joueurs du pool (avec la vidéo), le choix en or, l'ancre de glace et le grand oublié. Les <b>duels de la semaine</b> jumellent les équipes au hasard chaque lundi; l'équipe qui fait le plus de points du lundi au dimanche gagne. Juste pour le plaisir : ça ne change pas le classement.</p>`,
        },
        {
          q: "D'où viennent les trophées et les chances de gagner?",
          a: `<ul>
            <li><b>Vitrine des trophées</b> (Gazette) : 🏆 champion du mois (le plus de points dans le mois), 🥊 duel de la semaine gagné, 🎱 bingo gagné, ⭐ meilleure soirée du pool, 👑 chaque jour passé au 1er rang. Les <b>records du pool</b> sont juste en dessous.</li>
            <li><b>🎆 Coupe du Nouvel An</b> (Gazette) : le 1er janvier, tout le monde repart à zéro; seuls les points marqués à partir de cette date comptent, jusqu'à la fin de la saison régulière. Sous le classement, <b>🏮 la lanterne rouge</b> suit la course pour ne pas finir dernier.</li>
            <li><b>Chances</b> (Classement) : chaque matin, le site simule 5000 fois le reste de la saison, selon le rythme de chaque joueur et les matchs qui restent à son équipe. Le pourcentage, c'est la part des saisons simulées que votre équipe gagne. Les échanges à venir ne sont pas prévus.</li>
            <li>Pendant les matchs, l'onglet <b>Ce soir</b> affiche une alerte quand un joueur du pool marque. Touchez <b>🔕 Klaxon</b> pour l'entendre aussi.</li>
          </ul>
          <p>Tout ça, c'est pour le plaisir : seuls les points comptent au classement.</p>`,
        },
        {
          // feature: cards
          q: "C'est quoi, les cartes de hockey?",
          a: `<p>Chaque équipe reçoit une carte de hockey par semaine (onglet <b>Équipes</b>), avec ses points de la semaine, son rang et son total. Sa rareté dépend du rang de la semaine : 1er <b>légendaire</b>, 2e-3e <b>épique</b>, 4e-8e <b>rare</b>, les autres <b>commune</b>. Bougez la carte (ou votre téléphone) pour voir le reflet, gardez-la avec <b>Enregistrer l'image</b>, et retrouvez toutes vos cartes dans <b>Mon album</b>.</p>`,
        },
        {
          // feature: radio
          q: "C'est quoi, Les Ondes de la Patinoire?",
          a: `<p>Une petite émission de radio de 2-3 minutes sur la soirée d'hier, chaque matin de match : deux animateurs québécois commentent le pool et taquinent les participants. Touchez ▶ sur la page d'accueil; l'émission continue de jouer pendant que vous visitez le reste du site. Le texte est écrit par Claude à partir des vrais résultats, et les voix sont générées par ElevenLabs.</p>`,
        },
        {
          // feature: arena
          q: "C'est quoi, le mode Aréna?",
          a: `<p>Un écran géant pour regarder les matchs en famille : ouvrez l'onglet <b>📺 Télé</b> et touchez <b>Lancer l'Aréna</b> (ou ouvrez le lien du site suivi de <code>#tv</code> sur la télé). Le classement se met à jour en direct avec les points de la soirée, chaque but d'un joueur du pool s'affiche en plein écran avec le klaxon, et le bingo et les pointages défilent. Touchez <b>Plein écran</b> pour cacher le reste; l'écran reste allumé.</p>`,
        },
        {
          q: "Comment marche le bingo?",
          a: `<ul>
            <li>Chaque soir de match, chaque participant reçoit sa propre carte de 9 cases (le centre est libre). La carte arrive l'après-midi.</li>
            <li>Les cases viennent des matchs du soir : des joueurs de votre équipe (« Suzuki marque »), des équipes de la LNH (« MTL gagne ») et des moments de la soirée (« Un but en avantage numérique »).</li>
            <li>Rien à faire : les cases se cochent toutes seules pendant les matchs. ✗ veut dire que la case ne peut plus arriver ce soir.</li>
            <li>Les joueurs blessés ou suspendus (onglet <b>Blessés</b>) ne sont pas dans les cartes. La liste suit les nouvelles jusqu'au premier match de la journée, puis ne change plus.</li>
            <li>Une ligne = 3 cases cochées en ligne, en colonne ou en diagonale. À la fin de la soirée, le plus de lignes gagne (puis le plus de cases). Il faut au moins une ligne pour gagner : sans ligne, pas de gagnant.</li>
            <li>Le gagnant reste affiché le lendemain (« Bingo d'hier »), et chaque bingo gagné vaut un trophée 🎱 dans la Vitrine des trophées.</li>
            <li><b>Le bingo de la saison :</b> le <b>Classement du bingo</b> (onglet Bingo) compte les bingos gagnés toute la saison. À la fin de la saison régulière, le plus de bingos gagnés est champion (égalité : le plus de lignes, puis de cases). Son prix : une carte-cadeau Amazon offerte par Hugo, la couronne 🎱👑 à côté de son équipe toute la saison prochaine, et le choix de la case du centre de toutes les cartes l'an prochain.</li>
            <li>Touchez un nom dans <b>La course</b> pour voir la carte de quelqu'un d'autre.</li>
          </ul>`,
        },
      ],
    },
  ],
  en: [
    {
      section: "Your image",
      items: [
        {
          q: "How do I change my photo or my team logo?",
          a: `<ol>
            <li>Tap <b>Log in</b> at the top, pick your name and enter your PIN.</li>
            <li>Go to the <b>Teams</b> tab. Your <b>My team</b> card is at the top.</li>
            <li>Tap <b>Change my image</b>, then pick <b>Team logo</b> or <b>My photo</b>.</li>
            <li>Tap <b>Choose an image…</b> and pick an image from your phone or computer. A preview shows the result.</li>
            <li>Tap <b>Send to Hugo</b>.
              <ul>
                <li><b>On a phone:</b> the share menu opens. Pick Messages or Mail and send it to Hugo.</li>
                <li><b>On a computer:</b> the image is saved to your downloads and an email opens. Attach the image and send.</li>
              </ul></li>
          </ol>
          <p>Hugo publishes it, and it shows up on the site a few minutes later.</p>
          {{teamsButton}}`,
        },
        {
          q: "What kind of image works best?",
          a: `<ul>
            <li><b>Photo:</b> a portrait where your face is clearly visible. It's cropped to a centered square and shown in a circle.</li>
            <li><b>Logo:</b> a square image, ideally a PNG with a transparent background. The whole logo is kept.</li>
            <li>JPG, PNG, WebP or GIF. No need to shrink it: the site does that.</li>
          </ul>`,
        },
        {
          q: "Where do my photo and logo show up?",
          a: `<p>Your <b>logo</b> appears in the standings, on your team card and in the Buzz tab. Your <b>photo</b> appears large on the podium, in your team's window and in "Tonight". With no image, your initials are shown.</p>`,
        },
      ],
    },
    {
      section: "Trades",
      items: [
        {
          q: "What are the trade rules?",
          a: `<ul>
            <li>Each team gets <b>{{f}} forward</b>, <b>{{d}} defense</b> and <b>{{g}} goalie</b> trade for the season.</li>
            <li>A player can only be swapped for another player <b>from the same round</b> of the form.</li>
            <li>Trades are allowed starting <b>{{opens}}</b>.</li>
            <li>Points your old player already earned <b>stay in your total</b>. The new player only counts from approval on.</li>
          </ul>`,
        },
        {
          q: "How do I propose a trade?",
          a: `<ol>
            <li>Tap <b>Log in</b> and enter your PIN.</li>
            <li>Go to the <b>Trades</b> tab.</li>
            <li><b>1. Player out:</b> tap the player you want to trade. The "R" shows his round.</li>
            <li><b>2. Player in:</b> the other players from that round appear, with their points this season. Tap your pick.</li>
            <li>Tap <b>Generate trade code</b>.</li>
            <li>Send the message to Hugo with <b>Copy</b>, <b>Share</b> or <b>Email</b>. Send it from <b>your own</b> phone or email: Hugo checks who sent it.</li>
          </ol>
          {{tradesButton}}`,
        },
        {
          q: "When does my trade count?",
          a: `<p>As soon as Hugo approves it. The standings update 2–3 minutes later and the trade shows under <b>Approved trades</b>. Your old player stays visible in your team's window with his points kept.</p>`,
        },
        {
          q: "I made a mistake or changed my mind.",
          a: `<p>Until Hugo approves it, nothing has happened: just tell him to cancel, then send a new code if you want. Once approved, the trade is final.</p>`,
        },
        {
          q: "Why is the \"Generate\" button greyed out?",
          a: `<p>Either the trade window isn't open yet (starts {{opens}}), you've already used your trade at that position, or step 1 or 2 is missing a pick.</p>`,
        },
      ],
    },
    {
      section: "The pool",
      items: [
        {
          q: "How do I log in? I forgot my PIN.",
          a: `<p>Tap <b>Log in</b>, pick your name and enter the PIN Hugo gave you. If you forgot it, ask Hugo for a new one. Logging in is only needed for "My team" and trades; anyone can see the standings.</p>`,
        },
        {
          q: "How are points calculated?",
          a: `<ul>{{scoring}}</ul><p>A player only earns points for you while he's on your team.</p><p><b>Tied on points?</b> The most bingo lines this season (🎱 column in the standings) goes ahead, then the most goals; if everything is equal, the teams share the rank.</p>`,
        },
        {
          q: "When do the standings update?",
          a: `<ul>
            <li><b>Every morning around 5 AM:</b> standings, trajectory and Buzz, with the previous night's games.</li>
            <li><b>During games</b> (every 15 minutes): the "Tonight" tab.</li>
            <li><b>A few minutes after</b> Hugo approves a trade or a new image.</li>
          </ul>`,
        },
        {
          q: "What are the Buzz tab and the duels?",
          a: `<p><b>Buzz</b> recaps the previous night: goals by pool players (with video), the Golden Pick, the Ice Anchor and the Snub. <b>Weekly duels</b> pair teams at random every Monday; whoever scores more from Monday to Sunday wins. Just for fun: it doesn't affect the standings.</p>`,
        },
        {
          q: "Where do the trophies and the odds come from?",
          a: `<ul>
            <li><b>Trophy case</b> (Buzz): 🏆 champion of the month (most points that month), 🥊 weekly duel won, 🎱 bingo won, ⭐ best night in the pool, 👑 each day spent in 1st place. The <b>pool records</b> are right below.</li>
            <li><b>🎆 New Year Cup</b> (Buzz): on January 1, everyone restarts at zero; only points scored from then until the end of the regular season count. Under the standings, <b>🏮 the red lantern</b> follows the race to stay out of last place.</li>
            <li><b>Odds</b> (Standings): every morning, the site simulates the rest of the season 5,000 times, from each player's pace and his team's remaining games. The percentage is the share of simulated seasons your team wins. Future trades aren't predicted.</li>
            <li>During games, the <b>Tonight</b> tab shows an alert when a pool player scores. Tap <b>🔕 Horn</b> to hear it too.</li>
          </ul>
          <p>It's all for fun: only points count in the standings.</p>`,
        },
        {
          // feature: cards
          q: "What are the hockey cards?",
          a: `<p>Every team gets a hockey card each week (<b>Teams</b> tab), with its points that week, its rank and its total. Rarity comes from the week's rank: 1st <b>legendary</b>, 2nd-3rd <b>epic</b>, 4th-8th <b>rare</b>, the rest <b>common</b>. Move the card (or tilt your phone) to see the shine, keep it with <b>Save image</b>, and find all your cards in <b>My album</b>.</p>`,
        },
        {
          // feature: radio
          q: "What's Les Ondes de la Patinoire?",
          a: `<p>A 2-3 minute radio show about last night, every morning after games: two Quebecois hosts talk about the pool and tease the participants (in French). Tap ▶ on the front page; the show keeps playing while you browse the rest of the site. Claude writes it from the real results, and ElevenLabs makes the voices.</p>`,
        },
        {
          // feature: arena
          q: "What's Arena mode?",
          a: `<p>A big screen to watch the games together: open the <b>📺 TV</b> tab and tap <b>Start the Arena</b> (or open the site's link followed by <code>#tv</code> on the TV). The standings update live with tonight's points, every goal by a pool player fills the screen with the horn, and the bingo and scores roll by. Tap <b>Full screen</b> to hide the rest; the screen stays on.</p>`,
        },
        {
          q: "How does the bingo work?",
          a: `<ul>
            <li>Every game night, each participant gets their own card of 9 squares (the centre is free). Cards show up in the afternoon.</li>
            <li>Squares come from tonight's games: players on your team ("Suzuki scores"), NHL teams ("MTL wins") and moments of the night ("A power-play goal").</li>
            <li>Nothing to do: squares tick themselves during the games. ✗ means the square can't happen tonight anymore.</li>
            <li>Injured or suspended players (<b>Injuries</b> tab) aren't on the cards. The list follows the news until the day's first game starts, then stays put.</li>
            <li>A line = 3 ticked squares in a row, a column or a diagonal. At the end of the night, the most lines wins (then the most squares). It takes at least one line to win: no line, no winner.</li>
            <li>The winner stays up the next day ("Last night's bingo"), and every bingo won earns a 🎱 trophy in the Trophy case.</li>
            <li><b>The season's bingo:</b> the <b>Bingo standings</b> (Bingo tab) count bingos won all season. At the end of the regular season, the most bingos won is champion (tie: most lines, then squares). The prize: an Amazon gift card from Hugo, the 🎱👑 crown next to their team all next season, and the pick of the centre square on every card next year.</li>
            <li>Tap a name in <b>The race</b> to see someone else's card.</li>
          </ul>`,
        },
      ],
    },
  ],
};

export function faqContent(lang, vars) {
  return FAQ[lang].map(sec => ({
    section: sec.section,
    items: sec.items.map(it => ({ q: it.q, a: it.a.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "") })),
  }));
}

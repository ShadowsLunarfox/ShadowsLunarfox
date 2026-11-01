const LANGUAGE_MOTION_CSS = `
  @keyframes profile-language-pop {
    0% { opacity:0; transform:translateY(7px) scale(.9); }
    65% { opacity:1; transform:translateY(-1px) scale(1.035); }
    100% { opacity:1; transform:translateY(0) scale(1); }
  }
  @keyframes profile-language-grow {
    0% { opacity:0; transform:scaleX(0) scaleY(.55); }
    70% { opacity:1; transform:scaleX(.97) scaleY(1.18); }
    100% { opacity:1; transform:scaleX(1) scaleY(1); }
  }
  .language-pop {
    transform-box:fill-box;
    transform-origin:center;
    animation:profile-language-pop .56s cubic-bezier(.2,.75,.25,1) backwards;
    animation-delay:var(--language-delay,0s);
  }
  .language-grow {
    transform-box:fill-box;
    transform-origin:left center;
    animation:profile-language-grow .95s cubic-bezier(.2,.75,.25,1) backwards;
    animation-delay:var(--language-delay,0s);
  }
  @media (prefers-reduced-motion:reduce) {
    .language-pop, .language-grow { animation:none !important; opacity:1; transform:none; }
  }
`;

const languageMotionDelay = (index = 0, start = 0.12) => `${(start + Math.min(index, 12) * 0.07).toFixed(2)}s`;

module.exports = { LANGUAGE_MOTION_CSS, languageMotionDelay };

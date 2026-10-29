// ---------- movement vocabulary: named full-body poses (a generic base library; clips add or override in choreography.json "poses")
// arms: [raise to side, raise forward, elbow bend forward, elbow bend in-plane, palm twist] (degrees), 'left'/'right' as seen
// from the audience (as in "positions"); "arms" sets both. head: [bow, tilt]. torso: [bend forward, bend to the side, twist].
// plie, releve: 0..1. leg.left / leg.right: [direction (0 front, 90 out to its side, 180 back), height (degrees from down),
// knee bend 0..1]. turn: degrees turned while moving into the pose. base: another pose to start from.
// A name ending in _L is the mirror of the same name ending in _R.
// Floor work: pitch tilts the whole body forward at the pelvis (90 = lying face down). kneel.left / kneel.right: [where the
// knee rests, metres forward of the dancer's spot (negative = behind), thigh angle from vertical (positive sits back toward
// the heels, 0 upright on the knees, negative lies forward of the knee, -90 lying flat)]; the shin lies along the floor behind
// the knee. A leg without kneel stands. wide: metres each foot steps out to the side (a wide stance).
// Arms that would reach into the floor rest on it.
const POSE_LIB={
  stand:      {arms:[8,5,5,0,0]},
  prep:       {arms:[14,22,28,8,0], head:[6,0]},                                   // bras bas, rounded
  first:      {arms:[22,62,38,22,0], head:[4,0]},                                  // rounded in front of the body
  second:     {arms:[78,14,12,0,10], head:[-3,0]},                                 // open to the sides
  fifth:      {arms:[160,18,28,6,40], head:[-8,0]},                                // rounded above the head
  demi_plie:  {base:'prep', plie:0.45},
  releve:     {base:'fifth', releve:1},
  reach_R:    {left:[30,40,20,0,0], right:[50,95,6,0,40], head:[-6,-6], torso:[6,0,-8]},   // reach forward-right, toward someone
  open_heart: {arms:[118,-12,8,0,70], head:[-16,0], torso:[-10,0,0]},              // chest lifted, arms wide and high
  curl:       {arms:[24,46,96,44,0], head:[28,0], torso:[30,0,0], plie:0.4},       // folded inward
  port_fwd:   {arms:[10,70,10,0,0], head:[20,0], torso:[42,0,0], plie:0.15},       // forward bend, arms reaching down-forward
  cambre:     {base:'fifth', head:[-18,0], torso:[-16,0,0]},                       // back bend
  side_bend_R:{left:[164,10,20,0,30], right:[30,10,30,10,0], head:[-4,10], torso:[0,-22,0]}, // bend toward the audience-right
  tendu_R:    {base:'second', leg:{right:[0,28,0]}},
  developpe_R:{left:[80,14,12,0,10], right:[60,70,20,0,20], head:[-6,0], leg:{right:[20,68,0]}, torso:[-4,0,0]},
  arabesque_R:{left:[60,110,6,0,30], right:[80,-6,8,0,10], head:[-10,0], torso:[16,0,0], leg:{right:[180,62,0]}},
  attitude_R: {left:[150,20,30,0,40], right:[80,10,14,0,10], head:[-8,0], torso:[8,0,0], leg:{right:[160,58,0.55]}},
  retire_R:   {base:'first', leg:{right:[25,48,1]}},
  pirouette_R:{base:'fifth', leg:{right:[25,48,1]}, releve:1, turn:360},
  promenade_R:{base:'attitude_R', turn:180},
  lunge_R:    {left:[60,80,10,0,20], right:[70,-10,10,0,0], head:[-6,0], torso:[10,0,0], plie:0.55, leg:{right:[180,22,0]}},
  bow:        {arms:[10,20,10,0,0], head:[30,0], torso:[24,0,0], plie:0.1},
  // floor work (getting up from lying face down goes through these in order)
  prone:      {pitch:86, kneel:{left:[-0.65,-86], right:[-0.65,-86]}, arms:[44,40,96,0,0], head:[4,62]},   // lying face down, hands by the chest, cheek on the floor
  prone_lift: {base:'prone', arms:[40,30,100,0,0], head:[-30,10], torso:[-14,0,0]},                        // hands by the chest, head and chest lifting
  all_fours:  {pitch:82, kneel:{left:[-0.4,0], right:[-0.4,0]}, arms:[6,8,0,0,0], head:[6,0]},             // hands under the shoulders
  child:      {pitch:50, torso:[54,0,0], kneel:{left:[-0.4,62], right:[-0.4,62]}, arms:[10,52,0,0,0], head:[24,0]},   // sitting back on the heels, folded forward
  sit_heels:  {torso:[22,0,0], kneel:{left:[-0.4,58], right:[-0.4,58]}, arms:[16,30,30,10,0], head:[22,0]},
  sit_open:   {torso:[-14,0,0], kneel:{left:[-0.4,58], right:[-0.4,58]}, arms:[118,-12,8,0,70], head:[-18,0]},   // kneeling, chest lifted, arms wide
  high_kneel: {torso:[-6,0,0], kneel:{left:[-0.4,0], right:[-0.4,0]}, arms:[160,18,28,6,40], head:[-8,0]},
  kneel_R:    {pitch:6, torso:[6,0,0], kneel:{right:[-0.4,4]}, arms:[78,14,12,0,10], head:[-3,0]},              // right knee down, left foot standing
  power_second:{wide:0.22, plie:0.75, arms:[86,4,0,86,60], head:[-6,0], torso:[-6,0,0]},                   // wide, deep, fists up
  thrust_R:   {base:'lunge_R', right:[30,165,0,0,0], left:[40,-20,60,0,0], head:[-14,0], torso:[-4,0,8]},  // the right arm drives up and forward
};

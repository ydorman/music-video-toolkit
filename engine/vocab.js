// ---------- movement vocabulary: named full-body poses (a generic base library; clips add or override in choreography.json "poses")
// arms: [raise to side, raise forward, elbow bend forward, elbow bend in-plane, palm twist] (degrees), 'left'/'right' as seen
// from the audience (as in "positions"); "arms" sets both. head: [bow, tilt]. torso: [bend forward, bend to the side, twist].
// plie, releve: 0..1. leg.left / leg.right: [direction (0 front, 90 out to its side, 180 back), height (degrees from down),
// knee bend 0..1]. turn: degrees turned while moving into the pose. base: another pose to start from.
// A name ending in _L is the mirror of the same name ending in _R.
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
};

// tour.js — Owner: shared
// The guided demo: four short scenes that show off the car in about 3 minutes, with hints that
// react to what the driver is doing. N skips to the next scene, Esc ends the tour.
// (Later the AI coach can speak these hints instead of just showing them.)

const STEPS = [
  {
    level: "reveal-curl",
    title: "1 / 4  ·  The reveal stunt",
    hint: function (ctx) {
      const car = ctx.car;
      const up = car.getUp().y;
      if (car.airborne && up < 0) {
        return "NOW: tap ROLL!";
      }
      if (!car.airborne && up < -0.4) {
        return "You're upside down, held on by 2 g of fan suction. Keep going…";
      }
      if (!car.fansOn) {
        return "Tap FANS first: 2 g of suction will hold you upside down.";
      }
      return "Drive up the curl at about 50–60 km/h. Tap ROLL as you fly off the top.";
    },
    done: function (ctx) {
      return ctx.status.reached;
    },
  },
  {
    level: "warehouse-parking",
    title: "2 / 4  ·  Real life: the last parking spot",
    hint: function () {
      return "One spot left (green arrow) and the purple SUV wants it. Beat it there: drive, or hold LIFT to fly over the rows.";
    },
    done: function (ctx) {
      return ctx.status.reached || ctx.status.failed;
    },
  },
  {
    level: "expressway",
    title: "3 / 4  ·  Rush hour",
    hint: function (ctx) {
      const road = ctx.level.highway;
      const z = ctx.car.getPosition().z;
      if (road && z > road.jamStart - 250 && z < road.jamEnd) {
        return "Accident ahead, every lane blocked! Hold LIFT and lean forward (tip the phone / ↑) to fly over it.";
      }
      return "Weave through the traffic toward your exit. Tap BOOST for a burst of 80 kN.";
    },
    done: function (ctx) {
      const road = ctx.level.highway;
      const z = ctx.car.getPosition().z;
      const pastJam = road && z > road.jamEnd + 40 && !ctx.car.airborne;
      return pastJam || ctx.status.reached || ctx.status.failed;
    },
  },
  {
    level: "suzuka",
    title: "4 / 4  ·  A lap of Suzuka",
    showTelemetry: true,
    hint: function () {
      return "The real Suzuka layout. Follow the racing line: green go, yellow lift, red brake. Fans on for more grip.";
    },
    done: function (ctx) {
      return ctx.status.reached;
    },
  },
];

export class Tour {
  // actions: { loadLevel(file), setTelemetry(visible), showCaption(title, text, footer), hideCaption() }
  constructor(actions) {
    this.actions = actions;
    this.active = false;
    this.index = 0;
    this.finishTimer = 0;
    this.loading = false;
  }

  start() {
    this.active = true;
    this.goTo(0);
  }

  stop() {
    this.active = false;
    this.actions.hideCaption();
  }

  next() {
    if (this.active) {
      this.goTo(this.index + 1);
    }
  }

  async goTo(index) {
    if (index >= STEPS.length) {
      this.actions.showCaption("That's the Roadster", "Free drive: pick any level from the menu.", "");
      this.active = false;
      setTimeout(this.actions.hideCaption, 6000);
      return;
    }
    this.index = index;
    this.finishTimer = 0;
    this.loading = true;
    const step = STEPS[index];
    await this.actions.loadLevel(step.level);
    this.actions.setTelemetry(step.showTelemetry === true);
    this.loading = false;
  }

  // Call every frame. ctx = { car, level, status }.
  update(dt, ctx) {
    if (!this.active || this.loading) {
      return;
    }
    const step = STEPS[this.index];
    if (this.finishTimer > 0) {
      // A short pause to enjoy the moment, then the next scene.
      this.finishTimer = this.finishTimer - dt;
      if (this.finishTimer <= 0) {
        this.next();
      }
      return;
    }
    if (step.done(ctx)) {
      this.finishTimer = 3;
      this.actions.showCaption(step.title, "Nice! Next scene in a moment…", "N next · Esc end tour");
      return;
    }
    this.actions.showCaption(step.title, step.hint(ctx), "N next · R retry · Esc end tour");
  }
}

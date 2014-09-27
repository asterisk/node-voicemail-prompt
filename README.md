# Asterisk Voicemail Prompt Interface

Prompt interface for Asterisk voicemail. This module supports playing prompts relating to voicemail.

# Installation

```bash
$ git clone https://github.com/asterisk/node-voicemail-prompt.git
$ cd node-voicemail-prompt
$ npm install -g .
```

or add the following the your package.json file

```JavaScript
"dependencies": {
  "voicemail-prompt": "asterisk/node-voicemail-prompt"
}
```

# Usage

Create a prompt object from a sequence of sounds and a channel

```JavaScript
var promptHelper = require('voicemail-prompt');
var sounds = [{
  sound: 'sound:hello-world',
  skipable: false, // can this stop be stopped during playback?
  postSilence: 1 // in seconds
}];

var prompt = promptHelper.create(sounds, channel);
```

Initiate playback of all sounds in sequence:

```JavaScript
prompt.play()
  .then(function(played) {
    // played will be true if all sounds completed
  })
  .catch(function(err) {
  })
  .done();
```

Stop the prompt at any point in the sequence:

```JavaScript
prompt.stop();
```

Calling stop while the sequence of sounds is still playing will return false from the original promise returned by the play operation.

If the channel hangs up while the sequence of sounds is still playing, the promise returned by the play operation will return an error that can be caught with the catch method of the promise.

# Development

After cloning the git repository, run the following to install the module and all dev dependencies:

```bash
$ npm install
$ npm link
```

Then run the following to run jshint and mocha tests:

```bash
$ grunt
```

jshint will enforce a minimal style guide. It is also a good idea to create unit tests when adding new features.

# License

Apache, Version 2.0. Copyright (c) 2014, Digium, Inc. All rights reserved.


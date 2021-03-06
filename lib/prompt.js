/**
 * Prompt module for Asterisk voicemail.
 *
 * @module tests-context
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

var ari = require('ari-client-wrapper');
var Q = require('q');
var machina = require('machina');

/**
 * Returns a new finite state machine instance for the given sounds and channel.
 *
 * @param {object[]} sounds - an array of sound objects
 * @param {Channel} channel - a channel instance
 * @param {object} replacements - object with keys matching sound variable
 *   name and value containing a replacement value
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {machina.Fsm} fsm - a finite state machine instance
 */
function fsm(sounds, channel, replacements, dependencies) {
  var fsmInstance = new machina.Fsm({

    initialState: 'init',

    // handler for channel hanging up
    hangupHandler: function(event) {
      dependencies.logger.trace('hangupHandler called');

      this.emit('Error', new Error('Channel hungup.'));
      this.transition('done');
    },

    // handler for playback finished
    playbackFinishedHandler: function(event, playback) {
      dependencies.logger.trace('playbackFinishedHandler called');

      dependencies.logger.debug({
        playback: playback
      }, 'PlaybackFinished received');

      this.handle('finished');
    },

    // removes playback finished handler
    removePlaybackFinishedHandler: function() {
      if (this.playback && this.currentPlaybackHandler) {
        dependencies.logger.trace('Removing playbackFinishedHandler');

        this.playback.removeListener('PlaybackFinished',
                                     this.currentPlaybackHandler);
        this.currentPlaybackHandler = null;
      }
    },

    // removes handler for channel hanging up
    removeHangupHandler: function() {
      if (this.currentHangupHandler) {
        dependencies.logger.trace('Removing hangupHandler');

        channel.removeListener('StasisEnd', this.currentHangupHandler);
        this.currentHangupHandler = null;
      }
    },

    states : {
      // bootstrapping
      'init' : {
        _onEnter: function() {
          var self = this;

          dependencies.logger.trace('In init state');

          var ariConfig = dependencies.config.getAppConfig().ari;
          ari.getClient(ariConfig, ariConfig.applicationName)
            .then(function(client) {
              self.client = client;
              self.transition('processing');
            })
            .catch(function(err) {
              self.emit('Error', err);
              self.transition('done');
            });

          this.currentHangupHandler = this.hangupHandler.bind(this);
          channel.once('StasisEnd', this.currentHangupHandler);
        },

        'play': function() {
          dependencies.logger.trace('Deferring play until processing state');

          this.deferUntilTransition('processing');
        },

        'stop': function() {
          dependencies.logger.trace('Deferring stop until processing state');

          this.deferUntilTransition('playing');
        }
      },

      // processing sounds
      'processing': {
        _onEnter: function() {
          dependencies.logger.trace('In processing state');
        },

        // begin playback of sound sequence
        play: function() {
          dependencies.logger.trace('play called');

          this.playlist = sounds.map(function(elem) {
            // clone object
            var sound = Object.keys(elem).reduce(function(obj, key) {
              obj[key] = elem[key];

              return obj;
            }, {});

            // see if a replacement value exists for this
            var regex = /\{(.+)\}/;
            var result = regex.exec(sound.sound);

            if (result) {
              var original = result[0];
              var replacement = result[1];
              sound.sound = sound.sound.replace(original,
                                                replacements[replacement]);
            }

            return sound;
          });

          dependencies.logger.debug({
            playlist: this.playlist
          }, 'created playlist');

          this.transition('playing');
          this.handle('next');
        }
      },

      // sound currently playing
      'playing' : {
        _onEnter: function() {
          dependencies.logger.trace('In playing state');
        },

        // start next sound playback
        next: function() {
          var self = this;

          dependencies.logger.trace('next called');

          // take first sound
          this.sound = this.playlist.splice(0, 1)[0];

          if (this.sound) {
            if (this.stopped && this.sound.skipable) {
              this.handle('finished');
            } else {
              this.playback = this.client.Playback();
              this.currentPlaybackHandler =
                  this.playbackFinishedHandler.bind(this);
              this.playback.once('PlaybackFinished',
                                 this.currentPlaybackHandler);

              var play = Q.denodeify(channel.play.bind(channel));

              play({media: this.sound.sound}, this.playback)
                .then(function(playback) {
                  dependencies.logger.debug({
                    playback: playback
                  }, 'Playing sound on channel');
                })
                .catch(function(err) {
                  self.emit('Error', err);
                  self.transition('done');
                });
            }
          } else {
            this.handle('finished');
          }
        },

        // handle playback finished event
        finished: function() {
          var self = this;

          dependencies.logger.trace('finished called');

          // if finished with all sounds
          if (!this.playlist.length) {
            if (this.stopped) {
              this.emit('PromptStopped');
            } else {
              this.emit('PromptFinished');
            }

            dependencies.logger.debug('playlist finished');

            this.transition('done');
          } else {
            // if stopped, handle next sound right away, otherwise handle
            // in # of seconds determined by postSilence
            var timeout = this.stopped ? 0: this.sound.postSilence * 1000;

            dependencies.logger.debug('Calling next in %s milliseconds',
                                      timeout);

            setTimeout(function() {
              self.handle('next');
            }, timeout);
          }
        },

        // stops the current sound and marks prompt as stopped
        stop: function() {
          var self = this;
          this.stopped = true;

          dependencies.logger.trace('stop called');

          if (this.sound && this.sound.skipable) {
            var stop = Q.denodeify(this.playback.stop.bind(this.playback));

            stop()
              .catch(function(err) {
                // ignore errors, PlaybackFinished will still be emitted
              });
          }
        }
      },

      // done processing sounds
      'done': {
        _onEnter: function() {
          dependencies.logger.trace('In done state');

          // cleanup
          this.removeHangupHandler();
          this.removePlaybackFinishedHandler();
        },

        '*': function() {
          dependencies.logger.error('Called handle on spent fsm');
        }
      }
    }
  });

  return fsmInstance;
}

/**
 * Returns a prompt object that can be used to play or stop a sequence of
 * sounds.
 *
 * @param {object[]} sounds - an array of sound objects
 * @param {Channel} channel - a channel instance
 * @param {object} replacements - object with keys matching sound variable
 *   name and value containing a replacement value
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} api - api for playing a prompt
 */
function createPrompt(sounds, channel, replacements, dependencies) {
  dependencies.logger = dependencies.logger.child({
    component: 'voicemail-prompt'
  });

  var state = fsm(sounds, channel, replacements, dependencies);

  var api = {
    play: function() {
      var deferred = Q.defer();

      state.on('PromptFinished', onFinished);

      state.on('PromptStopped', onStopped);

      state.on('Error', onError);

      process.nextTick(function() {
        state.handle('play');
      });

      return deferred.promise;

      function onFinished() {
        dependencies.logger.trace('Received PromptFinished from fsm');

        removeListeners();
        deferred.resolve(true);
      }

      function onStopped() {
        dependencies.logger.trace('Received PromptStopped from fsm');

        removeListeners();
        deferred.resolve(false);
      }

      function onError(err) {
        dependencies.logger.trace('Received Error from fsm');

        removeListeners();
        deferred.reject(err);
      }

      function removeListeners() {
        dependencies.logger.trace('Removing fsm event handlers');

        state.off('PromptFinished', onFinished);
        state.off('PromptStopped', onStopped);
        state.off('Error', onError);
      }
    },

    stop: function() {
      process.nextTick(function() {
        state.handle('stop');
      });
    }
  };

  dependencies.logger.info('Prompt helper created');

  return api;
}

/**
 * Returns module functions.
 *
 * @param {object} dependencies - object keyed by module dependencies
 * @returns {object} module - module functions
 */
module.exports = function(dependencies) {
  return {
    create: function(sounds, channel, replacements) {
      return createPrompt(sounds, channel, replacements, dependencies);
    }
  };
};

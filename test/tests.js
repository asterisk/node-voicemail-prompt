/**
 * Prompt module unit tests.
 *
 * @module tests-context
 * @copyright 2014, Digium, Inc.
 * @license Apache License, Version 2.0
 * @author Samuel Fortier-Galarneau <sgalarneau@digium.com>
 */

'use strict';

/*global describe:false*/
/*global beforeEach:false*/
/*global afterEach:false*/
/*global it:false*/

var mockery = require('mockery');
var Q = require('q');
var assert = require('assert');
var util = require('util');
var path = require('path');
var Emitter = require('events').EventEmitter;

var mockClient;
// used to test how many sounds were played by prompt module
var soundsPlayed = 0;
// milliseconds to delay async ops for mock requests
var asyncDelay = 100;
var mockeryOpts = {
  warnOnReplace: false,
  warnOnUnregistered: false,
  useCleanCache: true
};

/**
 * Returns a mock client that also acts as a Channel and Playback instance to
 * allow a single EventEmitter to be used for testing.
 *
 * The mock client is cached so tests can access it to emit events if
 * necessary.
 */
var getMockClient = function() {

  if (mockClient) {
    return mockClient;
  }

  var Client = function() {
    this.Playback = function() {
      return this;
    };

    this.getChannel = function() {
      return this;
    };

    // actually channel.play
    this.play = function() {
      var self = this;
      var innerDeferred = Q.defer();

      setTimeout(function() {
        innerDeferred.resolve();
        soundsPlayed += 1;
        self.emit('PlaybackFinished');
      }, asyncDelay);

      return innerDeferred.promise;
    };

    // actually playback.stop
    this.stop = function() {
      var innerDeferred = Q.defer();

      setTimeout(function() {
        innerDeferred.resolve();
      }, asyncDelay);

      return innerDeferred.promise;
    };
  };
  util.inherits(Client, Emitter);

  mockClient = new Client();

  return mockClient;
};

/**
 * Returns a mock app config for testing.
 */
var getMockAriConfig = function() {
  var config = {
    url: '',
    username: '',
    password: '',
    applicationName: ''
  };

  return config;
};

describe('prompt', function() {

  beforeEach(function(done) {

    mockery.enable(mockeryOpts);

    var clientMock = {
      getClient: function(url, username, password, appName) {
        var deferred = Q.defer();
        deferred.resolve(getMockClient());

        return deferred.promise;
      }
    };
    mockery.registerMock('ari-client-wrapper', clientMock);

    done();
  });

  afterEach(function(done) {
    mockery.disable();
    soundsPlayed = 0;

    done();
  });

  it('should support playing a sequence of sounds', function(done) {
    var ari = require('ari-client-wrapper');
    var promptHelper = require('../lib/prompt.js')(getMockAriConfig());

    var channel = getMockClient().getChannel();
    var sounds = [{
      sound: 'sound:hello-world',
      skipable: false,
      postSilence: 1
    }, {
      sound: 'sound:hello-world',
      skipable: true,
      postSilence: 0
    }];
    var prompts = promptHelper.create(sounds, channel);

    prompts.play()
      .then(function(played) {
        assert(played);
        assert(soundsPlayed === 2);

        done();
      })
      .done();
  });

  it('should support stopping a sequence of sounds', function(done) {
    var ari = require('ari-client-wrapper');
    var promptHelper = require('../lib/prompt.js')(getMockAriConfig());

    var channel = getMockClient().getChannel();
    var sounds = [{
      sound: 'sound:hello-world',
      skipable: false,
      postSilence: 1
    }, {
      sound: 'sound:hello-world',
      skipable: true,
      postSilence: 0
    }];
    var prompts = promptHelper.create(sounds, channel);

    prompts.play()
      .then(function(played) {
        assert(!played);
        assert(soundsPlayed < 2);

        done();
      })
      .done();
    prompts.stop();
  });

  it('should handle channel hanging up', function(done) {
    var ari = require('ari-client-wrapper');
    var promptHelper = require('../lib/prompt.js')(getMockAriConfig());

    var channel = getMockClient().getChannel();
    var sounds = [{
      sound: 'sound:hello-world',
      skipable: false,
      postSilence: 1
    }, {
      sound: 'sound:hello-world',
      skipable: true,
      postSilence: 0
    }];
    var prompts = promptHelper.create(sounds, channel);

    prompts.play()
      .catch(function(err) {
        assert(soundsPlayed < 2);
        assert(~err.toString().match(/Channel hungup\.$/));

        done();
      })
      .done();
    getMockClient().emit('StasisEnd', {});
  });

});

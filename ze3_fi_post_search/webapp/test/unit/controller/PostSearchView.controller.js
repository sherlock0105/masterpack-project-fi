/*global QUnit*/

sap.ui.define([
	"ze3/fi/post/search/ze3fipostsearch/controller/PostSearchView.controller"
], function (Controller) {
	"use strict";

	QUnit.module("PostSearchView Controller");

	QUnit.test("I should test the PostSearchView controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});

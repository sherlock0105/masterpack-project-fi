/*global QUnit*/

sap.ui.define([
	"ze3/qm/display/ze3qmdisplay/controller/QmDisplayView.controller"
], function (Controller) {
	"use strict";

	QUnit.module("QmDisplayView Controller");

	QUnit.test("I should test the QmDisplayView controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});

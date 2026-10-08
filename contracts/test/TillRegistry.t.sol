// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TillRegistry} from "../src/TillRegistry.sol";

contract TillRegistryTest is Test {
    TillRegistry reg;
    address owner = address(0xA11CE);
    address other = address(0xB0B);
    address till1 = address(0x7111);
    address till2 = address(0x7222);

    event TillRegistered(address indexed owner, address indexed till, string label);
    event TillRelabelled(address indexed owner, address indexed till, string label);
    event TillRetired(address indexed owner, address indexed till);

    function setUp() public {
        reg = new TillRegistry();
    }

    function test_register_setsOwnerAndLabel_emits() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit TillRegistered(owner, till1, "Till 1");
        reg.registerTill(till1, "Till 1");

        (address o, string memory label, bool retired) = reg.tillOf(till1);
        assertEq(o, owner);
        assertEq(label, "Till 1");
        assertFalse(retired);
        assertEq(reg.ownerOf(till1), owner);
        assertTrue(reg.isActiveTill(till1));
    }

    function test_register_rejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(TillRegistry.ZeroAddress.selector);
        reg.registerTill(address(0), "x");
    }

    function test_register_rejectsDuplicate_byAnyone() public {
        vm.prank(owner);
        reg.registerTill(till1, "Till 1");
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(TillRegistry.AlreadyRegistered.selector, till1));
        reg.registerTill(till1, "steal");
    }

    function test_register_rejectsLongLabel() public {
        bytes memory long = new bytes(65);
        vm.prank(owner);
        vm.expectRevert(TillRegistry.LabelTooLong.selector);
        reg.registerTill(till1, string(long));
    }

    function test_relabel_onlyOwner() public {
        vm.prank(owner);
        reg.registerTill(till1, "Till 1");

        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(TillRegistry.NotOwner.selector, till1, other));
        reg.relabelTill(till1, "Front");

        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit TillRelabelled(owner, till1, "Front");
        reg.relabelTill(till1, "Front");
        (, string memory label,) = reg.tillOf(till1);
        assertEq(label, "Front");
    }

    function test_relabel_unregisteredReverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(TillRegistry.NotRegistered.selector, till2));
        reg.relabelTill(till2, "x");
    }

    function test_retire_thenNoRelabelOrDoubleRetire() public {
        vm.startPrank(owner);
        reg.registerTill(till1, "Till 1");
        vm.expectEmit(true, true, false, false);
        emit TillRetired(owner, till1);
        reg.retireTill(till1);
        assertFalse(reg.isActiveTill(till1));
        assertEq(reg.ownerOf(till1), owner); // history retained

        vm.expectRevert(abi.encodeWithSelector(TillRegistry.Retired.selector, till1));
        reg.relabelTill(till1, "x");
        vm.expectRevert(abi.encodeWithSelector(TillRegistry.Retired.selector, till1));
        reg.retireTill(till1);
        vm.stopPrank();
    }

    function test_retire_onlyOwner() public {
        vm.prank(owner);
        reg.registerTill(till1, "Till 1");
        vm.prank(other);
        vm.expectRevert(abi.encodeWithSelector(TillRegistry.NotOwner.selector, till1, other));
        reg.retireTill(till1);
    }

    function test_separateOwners_doNotInterfere() public {
        vm.prank(owner);
        reg.registerTill(till1, "A");
        vm.prank(other);
        reg.registerTill(till2, "B");
        assertEq(reg.ownerOf(till1), owner);
        assertEq(reg.ownerOf(till2), other);
    }

    function testFuzz_register(address t, address o, string calldata label) public {
        vm.assume(t != address(0));
        vm.assume(bytes(label).length <= 64);
        vm.prank(o);
        reg.registerTill(t, label);
        assertEq(reg.ownerOf(t), o);
    }
}

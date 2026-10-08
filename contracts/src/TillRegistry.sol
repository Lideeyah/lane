// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TillRegistry
/// @notice Records which till addresses belong to which merchant owner.
/// @dev Holds no funds, no counters and no shared accumulator. Every write
///      touches only the slots of the till being registered, so unrelated
///      merchants never contend on storage. The ledger is built off-chain by
///      indexing ERC-20 transfers into registered tills.
contract TillRegistry {
    struct Till {
        address owner;
        string label;
        bool retired;
    }

    mapping(address till => Till) private _tills;

    event TillRegistered(address indexed owner, address indexed till, string label);
    event TillRelabelled(address indexed owner, address indexed till, string label);
    event TillRetired(address indexed owner, address indexed till);

    error ZeroAddress();
    error AlreadyRegistered(address till);
    error NotRegistered(address till);
    error NotOwner(address till, address caller);
    error Retired(address till);
    error LabelTooLong();

    uint256 public constant MAX_LABEL_BYTES = 64;

    /// @notice Register a till owned by the caller.
    function registerTill(address till, string calldata label) external {
        if (till == address(0)) revert ZeroAddress();
        if (bytes(label).length > MAX_LABEL_BYTES) revert LabelTooLong();
        Till storage t = _tills[till];
        if (t.owner != address(0)) revert AlreadyRegistered(till);
        t.owner = msg.sender;
        t.label = label;
        emit TillRegistered(msg.sender, till, label);
    }

    /// @notice Change the label of a till the caller owns.
    function relabelTill(address till, string calldata label) external {
        if (bytes(label).length > MAX_LABEL_BYTES) revert LabelTooLong();
        Till storage t = _onlyOwner(till);
        if (t.retired) revert Retired(till);
        t.label = label;
        emit TillRelabelled(msg.sender, till, label);
    }

    /// @notice Retire a till the caller owns. The address keeps its history;
    ///         it is simply no longer offered as an active till.
    function retireTill(address till) external {
        Till storage t = _onlyOwner(till);
        if (t.retired) revert Retired(till);
        t.retired = true;
        emit TillRetired(msg.sender, till);
    }

    function ownerOf(address till) external view returns (address) {
        return _tills[till].owner;
    }

    function tillOf(address till) external view returns (address owner, string memory label, bool retired) {
        Till storage t = _tills[till];
        return (t.owner, t.label, t.retired);
    }

    function isActiveTill(address till) external view returns (bool) {
        Till storage t = _tills[till];
        return t.owner != address(0) && !t.retired;
    }

    function _onlyOwner(address till) private view returns (Till storage t) {
        t = _tills[till];
        if (t.owner == address(0)) revert NotRegistered(till);
        if (t.owner != msg.sender) revert NotOwner(till, msg.sender);
    }
}

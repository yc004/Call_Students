const CLASSROOM_INVITE_COVER = '/assets/share/classroom-invite.jpg';

function classroomInvite(title, path) {
  return {
    title,
    path,
    imageUrl: CLASSROOM_INVITE_COVER,
  };
}

module.exports = {
  CLASSROOM_INVITE_COVER,
  classroomInvite,
};
